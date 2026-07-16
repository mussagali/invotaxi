"""Driver profile, shift and online-status business logic."""

import uuid
from collections.abc import Awaitable
from datetime import datetime, time
from typing import cast

import orjson
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models import Driver
from app.domain.repositories import DriversRepository
from app.domain.schemas import DriverMeOut, DriverOut, DriverPatch, DriverShiftOut
from app.services.telemetry import LIVE_GEO_KEY, POSITION_KEY


class DriverServiceError(Exception):
    def __init__(self, message: str, status_code: int) -> None:
        self.status_code = status_code
        super().__init__(message)


def _shift_is_active(start: time | None, end: time | None, current: time) -> bool:
    if start is None or end is None:
        return False
    if start <= end:
        return start <= current <= end
    return current >= start or current <= end


class DriversService:
    def __init__(self, session: AsyncSession, redis: Redis) -> None:
        self.session = session
        self.redis = redis
        self.repo = DriversRepository(session)

    async def get_me(self, driver_id: uuid.UUID) -> DriverMeOut:
        driver = await self._get(driver_id)
        return DriverMeOut(
            profile=DriverOut.model_validate(driver),
            current_shift=DriverShiftOut(
                start=driver.shift_start,
                end=driver.shift_end,
                is_active=_shift_is_active(
                    driver.shift_start, driver.shift_end, datetime.now().time()
                ),
            ),
        )

    async def _get(self, driver_id: uuid.UUID) -> Driver:
        driver = await self.repo.get(driver_id)
        if driver is None:
            raise DriverServiceError("driver not found", 404)
        return driver

    async def set_online(self, driver_id: uuid.UUID, is_online: bool) -> Driver:
        driver = await self._get(driver_id)
        driver.is_online = is_online
        await self.session.commit()
        await self.session.refresh(driver)

        event = orjson.dumps(
            {
                "type": "driver.online_changed",
                "driver_id": str(driver.user_id),
                "is_online": is_online,
                "region": driver.region,
            }
        )
        pipe = self.redis.pipeline(transaction=False)
        if is_online:
            pipe.sadd("drivers:online", str(driver.user_id))
            pipe.hset(f"driver:meta:{driver.user_id}", mapping={"region": driver.region})
        else:
            pipe.srem("drivers:online", str(driver.user_id))
            pipe.zrem(LIVE_GEO_KEY, str(driver.user_id))
            pipe.delete(POSITION_KEY.format(driver_id=driver.user_id))
        pipe.publish(f"dispatch:{driver.region}", event)
        await pipe.execute()
        return driver

    async def list(
        self,
        *,
        region: str | None,
        is_online: bool | None,
        limit: int,
        offset: int,
    ) -> list[Driver]:
        return await self.repo.list(
            region=region,
            is_online=is_online,
            limit=limit,
            offset=offset,
        )

    async def patch(self, driver_id: uuid.UUID, body: DriverPatch) -> Driver:
        driver = await self._get(driver_id)
        values = body.model_dump(exclude_unset=True)
        requested_online = values.pop("is_online", None)
        for field, value in values.items():
            setattr(driver, field, value)
        await self.session.commit()
        await self.session.refresh(driver)
        if requested_online is not None and requested_online != driver.is_online:
            return await self.set_online(driver_id, requested_online)
        if driver.is_online:
            await cast(
                Awaitable[int],
                self.redis.hset(f"driver:meta:{driver.user_id}", mapping={"region": driver.region}),
            )
        return driver
