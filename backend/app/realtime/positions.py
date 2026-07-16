"""Throttled order-position publication primitive."""

import uuid

from redis.asyncio import Redis

from app.domain.schemas import DriverPositionOut
from app.realtime.events import DriverPositionPayload, event
from app.services.event_bus import EventBus


async def publish_order_position(
    redis: Redis,
    bus: EventBus,
    order_id: uuid.UUID,
    position: DriverPositionOut,
) -> bool:
    throttle = f"realtime:position_throttle:{order_id}"
    if not await redis.set(throttle, "1", ex=3, nx=True):
        return False
    await bus.publish(
        f"order:{order_id}",
        event(
            "driver.position",
            DriverPositionPayload(
                order_id=order_id,
                driver_id=position.driver_id,
                lat=position.lat,
                lon=position.lon,
                ts=position.ts,
                speed=position.speed,
                heading=position.heading,
            ),
        ),
    )
    return True
