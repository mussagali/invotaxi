"""Redis-only ingestion and reads for live driver telemetry."""

import uuid
from collections.abc import Awaitable
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import structlog
from redis.asyncio import Redis

from app.domain.schemas import (
    KAZAKHSTAN_LAT_MAX,
    KAZAKHSTAN_LAT_MIN,
    KAZAKHSTAN_LON_MAX,
    KAZAKHSTAN_LON_MIN,
    DriverPositionOut,
    TelemetryIngestOut,
    TelemetryPoint,
)
from app.metrics import GPS_ANOMALIES, GPS_POINTS

LIVE_GEO_KEY = "drivers:live"
POSITION_KEY = "driver:pos:{driver_id}"
POSITION_TTL_SECONDS = 120
MAX_POINT_AGE = timedelta(minutes=5)
MAX_FUTURE_SKEW = timedelta(seconds=30)
MAX_ACCURACY_METERS = 5.0

logger = structlog.get_logger(__name__)

_INGEST_LUA = """
local allowed = redis.call('SET', KEYS[1], '1', 'PX', 1000, 'NX')
if not allowed then
    return -1
end
local anomalies = tonumber(ARGV[1])
if anomalies > 0 then
    redis.call('INCRBY', KEYS[2], anomalies)
    redis.call('EXPIRE', KEYS[2], 2764800)
end
local accepted = tonumber(ARGV[3])
if accepted > 0 then
    redis.call('GEOADD', KEYS[3], ARGV[4], ARGV[5], ARGV[2])
    redis.call('HSET', KEYS[4],
        'lat', ARGV[5], 'lon', ARGV[4], 'ts', ARGV[6],
        'speed', ARGV[7], 'heading', ARGV[8], 'accuracy_m', ARGV[9])
    redis.call('EXPIRE', KEYS[4], 120)
end
return accepted
"""


class TelemetryRateLimitError(Exception):
    """The driver sent more than one telemetry batch per second."""


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _position_from_hash(driver_id: uuid.UUID, values: dict[str, str]) -> DriverPositionOut | None:
    if not values:
        return None
    try:
        speed = values.get("speed") or None
        heading = values.get("heading") or None
        return DriverPositionOut(
            driver_id=driver_id,
            lat=float(values["lat"]),
            lon=float(values["lon"]),
            ts=datetime.fromisoformat(values["ts"]),
            accuracy_m=float(values["accuracy_m"]),
            speed=float(speed) if speed is not None else None,
            heading=float(heading) if heading is not None else None,
        )
    except (KeyError, TypeError, ValueError):
        logger.warning("gps_position_invalid", driver_id=str(driver_id))
        return None


async def get_driver_position(redis: Redis, driver_id: uuid.UUID) -> DriverPositionOut | None:
    values = await cast(
        Awaitable[dict[str, str]],
        redis.hgetall(POSITION_KEY.format(driver_id=driver_id)),
    )
    return _position_from_hash(driver_id, values)


async def get_driver_positions(
    redis: Redis, driver_ids: list[uuid.UUID]
) -> list[DriverPositionOut]:
    if not driver_ids:
        return []
    pipe = redis.pipeline(transaction=False)
    for driver_id in driver_ids:
        pipe.hgetall(POSITION_KEY.format(driver_id=driver_id))
    rows = await pipe.execute()
    positions = (
        _position_from_hash(driver_id, values)
        for driver_id, values in zip(driver_ids, rows, strict=True)
    )
    return [position for position in positions if position is not None]


class TelemetryService:
    def __init__(self, redis: Redis) -> None:
        self.redis = redis

    async def ingest(
        self,
        driver_id: uuid.UUID,
        points: list[TelemetryPoint],
        *,
        now: datetime | None = None,
    ) -> TelemetryIngestOut:
        current = _as_utc(now or datetime.now(UTC))
        valid: list[TelemetryPoint] = []
        anomalies: list[TelemetryPoint] = []
        stale: list[TelemetryPoint] = []
        inaccurate: list[TelemetryPoint] = []
        for point in points:
            in_bbox = (
                KAZAKHSTAN_LAT_MIN <= point.lat <= KAZAKHSTAN_LAT_MAX
                and KAZAKHSTAN_LON_MIN <= point.lon <= KAZAKHSTAN_LON_MAX
            )
            if not in_bbox:
                anomalies.append(point)
                continue
            timestamp = _as_utc(point.ts)
            if timestamp < current - MAX_POINT_AGE or timestamp > current + MAX_FUTURE_SKEW:
                stale.append(point)
                continue
            if point.accuracy_m > MAX_ACCURACY_METERS:
                inaccurate.append(point)
                continue
            valid.append(point)

        latest = max(valid, key=lambda item: _as_utc(item.ts)) if valid else None
        anomaly_key = f"anomaly:{driver_id}:{current.date().isoformat()}"
        args: list[Any] = [
            len(anomalies) + len(stale) + len(inaccurate),
            str(driver_id),
            len(valid),
        ]
        if latest is None:
            args.extend(["", "", "", "", "", ""])
        else:
            args.extend(
                [
                    latest.lon,
                    latest.lat,
                    _as_utc(latest.ts).isoformat(),
                    "" if latest.speed is None else latest.speed,
                    "" if latest.heading is None else latest.heading,
                    latest.accuracy_m,
                ]
            )

        pipe = self.redis.pipeline(transaction=False)
        pipe.eval(
            _INGEST_LUA,
            4,
            f"telemetry:rate:{driver_id}",
            anomaly_key,
            LIVE_GEO_KEY,
            POSITION_KEY.format(driver_id=driver_id),
            *args,
        )
        result = await pipe.execute()
        if int(result[0]) < 0:
            GPS_POINTS.labels(result="rejected").inc(len(points))
            GPS_ANOMALIES.labels(reason="rate_limited").inc(len(points))
            raise TelemetryRateLimitError

        GPS_POINTS.labels(result="accepted").inc(len(valid))
        GPS_POINTS.labels(result="rejected").inc(len(points) - len(valid))
        GPS_ANOMALIES.labels(reason="outside_bbox").inc(len(anomalies))
        GPS_ANOMALIES.labels(reason="timestamp").inc(len(stale))
        GPS_ANOMALIES.labels(reason="accuracy").inc(len(inaccurate))

        for point in anomalies:
            logger.warning(
                "gps_anomaly",
                driver_id=str(driver_id),
                lat=point.lat,
                lon=point.lon,
            )
        return TelemetryIngestOut(
            accepted=len(valid),
            rejected=len(points) - len(valid),
        )

    async def live_positions(self, online_driver_ids: set[uuid.UUID]) -> list[DriverPositionOut]:
        if not online_driver_ids:
            return []
        center_lon = (KAZAKHSTAN_LON_MIN + KAZAKHSTAN_LON_MAX) / 2
        center_lat = (KAZAKHSTAN_LAT_MIN + KAZAKHSTAN_LAT_MAX) / 2
        members: list[str] = await self.redis.geosearch(
            LIVE_GEO_KEY,
            longitude=center_lon,
            latitude=center_lat,
            width=3500,
            height=1800,
            unit="km",
        )
        selected = [
            uuid.UUID(member) for member in members if uuid.UUID(member) in online_driver_ids
        ]
        if not selected:
            return []
        return await get_driver_positions(self.redis, selected)
