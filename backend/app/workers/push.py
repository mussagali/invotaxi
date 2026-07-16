"""Push delivery adapters. The default adapter deliberately performs no I/O."""

import uuid
from collections.abc import Awaitable
from typing import Protocol, cast

import httpx
import structlog
from redis.asyncio import Redis

from app.realtime.events import RealtimeEvent

logger = structlog.get_logger(__name__)
DEVICE_TOKENS_KEY = "devices:user:{user_id}"


class PushSender(Protocol):
    async def send(self, user_id: uuid.UUID, event: RealtimeEvent) -> bool: ...


class NoopSender:
    async def send(self, user_id: uuid.UUID, event: RealtimeEvent) -> bool:
        return False


class FcmHttpSender:
    """Small FCM legacy HTTP adapter for deployments using a server key."""

    def __init__(self, redis: Redis, server_key: str) -> None:
        self.redis = redis
        self.server_key = server_key

    async def send(self, user_id: uuid.UUID, event: RealtimeEvent) -> bool:
        tokens = list(
            await cast(
                Awaitable[set[str]],
                self.redis.smembers(DEVICE_TOKENS_KEY.format(user_id=user_id)),
            )
        )
        if not tokens:
            return False
        body = {
            "registration_ids": tokens[:500],
            "data": {
                "event": event.model_dump_json(),
                "type": event.type,
            },
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(
                    "https://fcm.googleapis.com/fcm/send",
                    headers={
                        "Authorization": f"key={self.server_key}",
                        "Content-Type": "application/json",
                    },
                    json=body,
                )
            response.raise_for_status()
        except httpx.HTTPError as exc:
            logger.warning("push.fcm_failed", user_id=str(user_id), error=str(exc))
            return False
        return True


def make_push_sender(redis: Redis, server_key: str) -> PushSender:
    return FcmHttpSender(redis, server_key) if server_key else NoopSender()
