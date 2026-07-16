"""FastAPI dependencies: DB session, Redis, current user, role checks."""
import uuid
from collections.abc import AsyncIterator, Callable, Coroutine
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.security import InvalidTokenError, decode_token
from app.domain.enums import UserRole, UserStatus
from app.domain.models import User
from app.services.auth import AuthService

_bearer = HTTPBearer(auto_error=False)


def get_app_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.session_factory() as session:
        yield session


def get_redis(request: Request) -> Redis:
    redis: Redis = request.app.state.redis
    return redis


def get_auth_service(
    session: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
    settings: Annotated[Settings, Depends(get_app_settings)],
) -> AuthService:
    return AuthService(session, redis, settings.secret_key)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=401, detail=detail, headers={"WWW-Authenticate": "Bearer"})


async def get_token_payload(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    settings: Annotated[Settings, Depends(get_app_settings)],
    auth: Annotated[AuthService, Depends(get_auth_service)],
) -> dict[str, Any]:
    if credentials is None:
        raise _unauthorized("missing bearer token")
    try:
        payload = decode_token(
            credentials.credentials, secret_key=settings.secret_key, expected_type="access"
        )
    except InvalidTokenError as exc:
        raise _unauthorized(str(exc)) from exc
    if await auth.is_access_revoked(payload):
        raise _unauthorized("token revoked")
    return payload


async def get_current_user(
    payload: Annotated[dict[str, Any], Depends(get_token_payload)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    user = await session.get(User, uuid.UUID(payload["sub"]))
    if user is None or user.status != UserStatus.active:
        raise _unauthorized("user not found or blocked")
    return user


def require_roles(
    *roles: UserRole,
) -> Callable[..., Coroutine[Any, Any, User]]:
    async def _check(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="insufficient role")
        return user

    return _check
