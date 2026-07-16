"""Auth business logic: login, refresh rotation, logout, rate limiting."""
import time as time_mod
import uuid
from collections.abc import Awaitable
from datetime import UTC, datetime
from typing import Any, cast

import structlog
from anyio import CapacityLimiter, to_thread
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import (
    ACCESS_TOKEN_TTL,
    REFRESH_TOKEN_TTL,
    InvalidTokenError,
    create_token_pair,
    decode_token,
    mask_phone,
    normalize_phone,
    verify_password,
)
from app.domain.enums import UserStatus
from app.domain.models import User

logger = structlog.get_logger(__name__)

LOGIN_RATE_LIMIT = 5
LOGIN_RATE_WINDOW_SEC = 60
# Argon2's defaults reserve substantial CPU and memory. The application runs
# two API processes in the measured production profile, so two verifications
# per process provide enough login throughput without the 40-thread default
# turning a ramp-up into a CPU/memory stampede.
PASSWORD_VERIFY_CONCURRENCY = 2
_password_verify_limiter = CapacityLimiter(PASSWORD_VERIFY_CONCURRENCY)

REFRESH_KEY = "auth:refresh:{jti}"
SESSIONS_KEY = "auth:sessions:{user_id}"
BLACKLIST_KEY = "auth:bl:{jti}"
REVOKE_ALL_KEY = "auth:revoke_all:{user_id}"


class AuthError(Exception):
    """401-class failure."""


class RateLimitedError(Exception):
    def __init__(self, retry_after: int) -> None:
        self.retry_after = retry_after
        super().__init__(f"rate limited, retry after {retry_after}s")


class AuthService:
    def __init__(self, session: AsyncSession, redis: Redis, secret_key: str) -> None:
        self.session = session
        self.redis = redis
        self.secret_key = secret_key

    async def check_login_rate_limit(self, phone: str, ip: str) -> None:
        """Sliding window: max 5 attempts per phone+ip per minute."""
        key = f"auth:rl:{phone}:{ip}"
        now = time_mod.time()
        pipe = self.redis.pipeline()
        pipe.zremrangebyscore(key, 0, now - LOGIN_RATE_WINDOW_SEC)
        pipe.zcard(key)
        _, current = await pipe.execute()
        if current >= LOGIN_RATE_LIMIT:
            oldest = await self.redis.zrange(key, 0, 0, withscores=True)
            retry_after = LOGIN_RATE_WINDOW_SEC
            if oldest:
                retry_after = max(1, int(oldest[0][1] + LOGIN_RATE_WINDOW_SEC - now) + 1)
            raise RateLimitedError(retry_after)
        pipe = self.redis.pipeline()
        pipe.zadd(key, {uuid.uuid4().hex: now})
        pipe.expire(key, LOGIN_RATE_WINDOW_SEC * 2)
        await pipe.execute()

    async def login(self, raw_phone: str, password: str, ip: str) -> tuple[User, str, str]:
        try:
            phone = normalize_phone(raw_phone)
        except ValueError as exc:
            raise AuthError("invalid credentials") from exc

        await self.check_login_rate_limit(phone, ip)

        user = (
            await self.session.execute(select(User).where(User.phone == phone))
        ).scalar_one_or_none()
        # The remaining credential verification and token issuance do not use
        # PostgreSQL. Release the request-scoped transaction before waiting for
        # an Argon2 worker slot; otherwise a login burst pins every pool
        # connection behind CPU work and unrelated requests time out.
        await self.session.close()
        if (
            user is None
            or user.status != UserStatus.active
            # Argon2 is deliberately CPU/memory expensive. Running it on the
            # event-loop thread stalls unrelated HTTP requests and WebSocket
            # heartbeats during login bursts, so keep the exact same verifier
            # but execute it in a deliberately bounded worker-thread pool.
            or not await to_thread.run_sync(
                verify_password,
                user.password_hash,
                password,
                limiter=_password_verify_limiter,
            )
        ):
            logger.info("auth.login_failed", phone=mask_phone(phone), ip=ip)
            raise AuthError("invalid credentials")

        access, refresh = await self._issue_pair(user)
        logger.info("auth.login_ok", phone=mask_phone(phone), user_id=str(user.id))
        return user, access, refresh

    async def _issue_pair(self, user: User) -> tuple[str, str]:
        access, refresh, _, refresh_jti = create_token_pair(
            user_id=user.id, role=user.role.value, secret_key=self.secret_key
        )
        ttl = int(REFRESH_TOKEN_TTL.total_seconds())
        pipe = self.redis.pipeline()
        pipe.set(REFRESH_KEY.format(jti=refresh_jti), str(user.id), ex=ttl)
        pipe.sadd(SESSIONS_KEY.format(user_id=user.id), refresh_jti)
        pipe.expire(SESSIONS_KEY.format(user_id=user.id), ttl)
        await pipe.execute()
        return access, refresh

    async def refresh(self, refresh_token: str) -> tuple[User, str, str]:
        try:
            payload = decode_token(
                refresh_token, secret_key=self.secret_key, expected_type="refresh"
            )
        except InvalidTokenError as exc:
            raise AuthError(str(exc)) from exc

        jti: str = payload["jti"]
        user_id = uuid.UUID(payload["sub"])
        consumed = await self.redis.getdel(REFRESH_KEY.format(jti=jti))
        if consumed is None:
            # Re-use of a rotated/unknown refresh token: token theft signal.
            logger.warning("auth.refresh_reuse_detected", user_id=str(user_id))
            await self.revoke_all_sessions(user_id)
            raise AuthError("refresh token already used")

        await cast(Awaitable[int], self.redis.srem(SESSIONS_KEY.format(user_id=user_id), jti))
        user = await self.session.get(User, user_id)
        if user is None or user.status != UserStatus.active:
            raise AuthError("user not found or blocked")

        access, refresh = await self._issue_pair(user)
        return user, access, refresh

    async def logout(self, access_payload: dict[str, Any]) -> None:
        """Blacklist the access jti until expiry; kill the paired refresh."""
        jti = access_payload["jti"]
        exp = int(access_payload["exp"])
        ttl = max(1, exp - int(datetime.now(UTC).timestamp()))
        pipe = self.redis.pipeline()
        pipe.set(BLACKLIST_KEY.format(jti=jti), "1", ex=ttl)
        rjti = access_payload.get("rjti")
        if rjti:
            pipe.delete(REFRESH_KEY.format(jti=rjti))
            pipe.srem(SESSIONS_KEY.format(user_id=access_payload["sub"]), rjti)
        await pipe.execute()

    async def revoke_all_sessions(self, user_id: uuid.UUID) -> None:
        sessions_key = SESSIONS_KEY.format(user_id=user_id)
        jtis = await cast(Awaitable[set[str]], self.redis.smembers(sessions_key))
        pipe = self.redis.pipeline()
        for jti in jtis:
            pipe.delete(REFRESH_KEY.format(jti=jti))
        pipe.delete(sessions_key)
        # Access tokens issued before now die at the dependency check.
        pipe.set(
            REVOKE_ALL_KEY.format(user_id=user_id),
            str(int(datetime.now(UTC).timestamp())),
            ex=int(ACCESS_TOKEN_TTL.total_seconds()) + 60,
        )
        await pipe.execute()

    async def is_access_revoked(self, payload: dict[str, Any]) -> bool:
        if await self.redis.exists(BLACKLIST_KEY.format(jti=payload["jti"])):
            return True
        revoked_at = await self.redis.get(REVOKE_ALL_KEY.format(user_id=payload["sub"]))
        return revoked_at is not None and int(payload["iat"]) <= int(revoked_at)
