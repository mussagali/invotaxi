"""The single publication boundary for realtime events."""

import uuid

from redis.asyncio import Redis

from app.domain.enums import OrderStatus
from app.realtime.events import RealtimeEvent
from app.workers.push import NoopSender, PushSender

PRESENCE_KEY = "realtime:presence:{user_id}"


class EventBus:
    def __init__(self, redis: Redis, push_sender: PushSender | None = None) -> None:
        self.redis = redis
        self.push_sender = push_sender or NoopSender()

    async def publish(self, channel: str, event: RealtimeEvent) -> int:
        receivers = int(await self.redis.publish(channel, event.model_dump_json()))
        user_id = self._push_recipient(channel, event)
        if user_id is not None and not await self.redis.exists(
            PRESENCE_KEY.format(user_id=user_id)
        ):
            await self.push_sender.send(user_id, event)
        return receivers

    @staticmethod
    def _push_recipient(channel: str, event: RealtimeEvent) -> uuid.UUID | None:
        if event.type == "route.published" and channel.startswith("driver:"):
            return uuid.UUID(channel.removeprefix("driver:"))
        if event.type == "order.status_changed" and event.payload.get("status") in {
            OrderStatus.assigned.value,
            OrderStatus.driver_en_route.value,
        }:
            return uuid.UUID(str(event.payload["client_id"]))
        return None
