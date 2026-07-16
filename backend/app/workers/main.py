import os
import re
import uuid
from collections.abc import Awaitable
from datetime import UTC, date, datetime, timedelta
from typing import Any, cast

import structlog
from arq import cron
from arq.connections import RedisSettings
from arq.constants import default_queue_name
from prometheus_client import start_http_server
from redis.asyncio import Redis
from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.domain.enums import OrderStatus
from app.domain.models import Driver, DriverTrackHistory, Order
from app.domain.partitions import ensure_track_history_partition
from app.domain.repositories import OrdersRepository
from app.metrics import ARQ_QUEUE_SIZE
from app.realtime.events import DriverPositionPayload, event
from app.realtime.hub import ACTIVE_DISTRICTS_KEY, ACTIVE_ORDERS_KEY
from app.realtime.positions import publish_order_position
from app.services.dispatch import run_dispatch_job
from app.services.event_bus import EventBus
from app.services.reports import cleanup_reports, generate_report
from app.services.telemetry import get_driver_positions
from app.workers.push import make_push_sender

logger = structlog.get_logger(__name__)


async def ping_task(ctx: dict[str, Any]) -> str:
    logger.info("ping_task.executed")
    return "pong"


async def startup(ctx: dict[str, Any]) -> None:
    settings = get_settings()
    ctx["reports_dir"] = settings.reports_dir
    ctx["telemetry_redis"] = Redis.from_url(settings.redis_url, decode_responses=True)
    metrics_server, metrics_thread = start_http_server(
        int(os.environ.get("WORKER_METRICS_PORT", "8001"))
    )
    ctx["metrics_server"] = metrics_server
    ctx["metrics_thread"] = metrics_thread
    if "session_factory" in ctx:
        return
    engine = create_async_engine(settings.database_url, pool_size=5, max_overflow=5)
    ctx["db_engine"] = engine
    bus = EventBus(
        ctx["telemetry_redis"],
        make_push_sender(ctx["telemetry_redis"], settings.fcm_server_key),
    )
    ctx["event_bus"] = bus
    ctx["session_factory"] = async_sessionmaker(
        engine, expire_on_commit=False, info={"event_bus": bus}
    )


async def shutdown(ctx: dict[str, Any]) -> None:
    metrics_server = ctx.get("metrics_server")
    if metrics_server is not None:
        metrics_server.shutdown()
        metrics_server.server_close()
    metrics_thread = ctx.get("metrics_thread")
    if metrics_thread is not None:
        metrics_thread.join(timeout=5)
    telemetry_redis: Redis | None = ctx.get("telemetry_redis")
    if telemetry_redis is not None:
        await telemetry_redis.aclose()
    engine: AsyncEngine | None = ctx.get("db_engine")
    if engine is not None:
        await engine.dispose()


async def update_arq_queue_metric(ctx: dict[str, Any]) -> int:
    """Refresh the observable default ARQ queue depth."""
    redis: Redis = ctx["telemetry_redis"]
    size = int(await redis.zcard(default_queue_name))
    ARQ_QUEUE_SIZE.set(size)
    return size


async def flush_driver_positions(ctx: dict[str, Any]) -> int:
    """Persist one current Redis position per online driver in one transaction."""
    session_factory: async_sessionmaker[Any] = ctx["session_factory"]
    async with session_factory() as session:
        driver_ids = list(
            await session.scalars(select(Driver.user_id).where(Driver.is_online.is_(True)))
        )
        positions = await get_driver_positions(ctx["telemetry_redis"], driver_ids)
        if not positions:
            return 0
        rows = [
            {
                "driver_id": position.driver_id,
                "ts": position.ts,
                "lat": position.lat,
                "lon": position.lon,
                "accuracy_m": position.accuracy_m,
            }
            for position in positions
        ]
        days = {position.ts.astimezone(UTC).date() for position in positions}
        conn = await session.connection()
        for day in sorted(days):
            await ensure_track_history_partition(conn, day)
        await session.execute(insert(DriverTrackHistory), rows)
        await session.commit()
    logger.info("driver_positions.flushed", count=len(rows))
    return len(rows)


async def publish_realtime_positions(ctx: dict[str, Any]) -> int:
    """Fan out one fresh position per listened active order, at most every three seconds."""
    redis: Redis = ctx["telemetry_redis"]
    order_values = await cast(Awaitable[set[str]], redis.smembers(ACTIVE_ORDERS_KEY))
    districts = await cast(Awaitable[set[str]], redis.smembers(ACTIVE_DISTRICTS_KEY))
    order_ids: list[uuid.UUID] = []
    for value in order_values:
        try:
            order_ids.append(uuid.UUID(value))
        except ValueError:
            await cast(Awaitable[int], redis.srem(ACTIVE_ORDERS_KEY, value))
    if not order_ids and not districts:
        return 0

    bus: EventBus = ctx.get("event_bus") or EventBus(redis)
    session_factory: async_sessionmaker[Any] = ctx["session_factory"]
    published = 0
    async with session_factory() as session:
        orders = list(
            await session.scalars(
                select(Order).where(
                    Order.id.in_(order_ids),
                    Order.status.in_(
                        (
                            OrderStatus.assigned,
                            OrderStatus.driver_en_route,
                            OrderStatus.picked_up,
                        )
                    ),
                )
            )
        )
        active_ids = {order.id for order in orders}
        stale_ids = set(order_ids) - active_ids
        if stale_ids:
            await cast(
                Awaitable[int],
                redis.srem(ACTIVE_ORDERS_KEY, *(str(order_id) for order_id in stale_ids)),
            )
        repository = OrdersRepository(session)
        for order in orders:
            driver_id = await repository.get_assigned_driver_id(order.id)
            if driver_id is None:
                continue
            positions = await get_driver_positions(redis, [driver_id])
            if not positions:
                continue
            position = positions[0]
            if await publish_order_position(redis, bus, order.id, position):
                published += 1
        if districts:
            drivers = list(
                await session.scalars(
                    select(Driver).where(
                        Driver.region.in_(districts), Driver.is_online.is_(True)
                    )
                )
            )
            positions = await get_driver_positions(
                redis, [driver.user_id for driver in drivers]
            )
            regions = {driver.user_id: driver.region for driver in drivers}
            for position in positions:
                throttle = f"realtime:dispatch_position:{position.driver_id}"
                if not await redis.set(throttle, "1", ex=3, nx=True):
                    continue
                await bus.publish(
                    f"dispatch:{regions[position.driver_id]}",
                    event(
                        "driver.position",
                        DriverPositionPayload(
                            driver_id=position.driver_id,
                            lat=position.lat,
                            lon=position.lon,
                            ts=position.ts,
                            speed=position.speed,
                            heading=position.heading,
                        ),
                    ),
                )
                published += 1
    return published


_PARTITION_RE = re.compile(r"^driver_track_history_(\d{8})$")


async def cleanup_track_history_partitions(ctx: dict[str, Any]) -> int:
    """Drop all daily history partitions strictly older than the 30-day window."""
    cutoff = date.today() - timedelta(days=30)
    session_factory: async_sessionmaker[Any] = ctx["session_factory"]
    async with session_factory() as session:
        names = list(
            await session.scalars(
                text(
                    "SELECT child.relname "
                    "FROM pg_inherits "
                    "JOIN pg_class parent ON pg_inherits.inhparent = parent.oid "
                    "JOIN pg_class child ON pg_inherits.inhrelid = child.oid "
                    "WHERE parent.relname = 'driver_track_history'"
                )
            )
        )
        stale: list[str] = []
        for name in names:
            match = _PARTITION_RE.fullmatch(name)
            if match and datetime.strptime(match.group(1), "%Y%m%d").date() < cutoff:
                stale.append(name)
        for name in stale:
            await session.execute(text(f'DROP TABLE IF EXISTS "{name}"'))
        await session.commit()
    logger.info("track_history_partitions.cleaned", count=len(stale))
    return len(stale)


class WorkerSettings:
    """ARQ worker entrypoint: `arq app.workers.main.WorkerSettings`."""

    functions = [
        ping_task,
        flush_driver_positions,
        cleanup_track_history_partitions,
        run_dispatch_job,
        publish_realtime_positions,
        generate_report,
        cleanup_reports,
        update_arq_queue_metric,
    ]
    cron_jobs = [
        cron(flush_driver_positions, second=0),
        cron(publish_realtime_positions, second=set(range(0, 60, 3))),
        cron(cleanup_track_history_partitions, hour=2, minute=15, second=0),
        cron(cleanup_reports, hour=3, minute=15, second=0),
        cron(update_arq_queue_metric, second=set(range(0, 60, 5))),
    ]
    on_startup = startup
    on_shutdown = shutdown
    health_check_interval = 30
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
