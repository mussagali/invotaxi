"""Dispatch job orchestration and incremental insertion."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import asdict
from datetime import UTC, date, datetime
from functools import wraps
from time import perf_counter, time
from typing import Any, ParamSpec

import structlog
from arq.connections import ArqRedis
from redis.asyncio import Redis
from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.domain.enums import OrderStatus, PlanStatus, RoutingJobStatus
from app.domain.models import Driver, Order, RoutePlan, RoutingJob, User
from app.domain.repositories import (
    DriversRepository,
    OrdersRepository,
    PlansRepository,
    RoutingJobsRepository,
)
from app.domain.schemas import DispatchInsertResult
from app.metrics import (
    DISPATCH_JOB_DURATION,
    DISPATCH_JOB_IN_PROGRESS,
    DISPATCH_JOB_LAST_DURATION,
    DISPATCH_JOB_STARTED_TIMESTAMP,
)
from app.realtime.events import (
    OrderExceptionPayload,
    PlanDraftReadyPayload,
    RouteUpdatedPayload,
    event,
)
from app.services.dispatch_adapter import adapt_dispatch
from app.services.event_bus import EventBus
from app.services.order_state import transition_order
from app.services.plans import PlansService, persist_solution
from app.services.telemetry import get_driver_positions
from routing import DriverPosition, online_insert, solve

logger = structlog.get_logger(__name__)
UNASSIGNED_REASON = "не влез в парк ±15 мин"
P = ParamSpec("P")


def _observe_dispatch_job(
    function: Callable[P, Awaitable[bool]],
) -> Callable[P, Awaitable[bool]]:
    @wraps(function)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> bool:
        started = perf_counter()
        status = "failed"
        DISPATCH_JOB_IN_PROGRESS.inc()
        DISPATCH_JOB_STARTED_TIMESTAMP.set(time())
        try:
            result = await function(*args, **kwargs)
            status = "success" if result else "failed"
            return result
        finally:
            duration = perf_counter() - started
            DISPATCH_JOB_DURATION.labels(status=status).observe(duration)
            DISPATCH_JOB_LAST_DURATION.labels(status=status).set(duration)
            DISPATCH_JOB_IN_PROGRESS.dec()
            DISPATCH_JOB_STARTED_TIMESTAMP.set(0)

    return wrapper


class DispatchServiceError(Exception):
    def __init__(self, message: str, status_code: int = 409) -> None:
        self.status_code = status_code
        super().__init__(message)


async def _scope_lock(session: AsyncSession, service_date: date, district: str) -> None:
    key = f"dispatch:{service_date.isoformat()}:{district}"
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": key}
    )


def _issues(solution: Any) -> dict[str, Any] | None:
    rows = [
        {
            "code": issue.code,
            "message": issue.message,
            "driver_id": issue.driver_id,
            "order_id": issue.order_id,
        }
        for issue in solution.validation.issues
    ]
    return {"issues": rows} if rows else None


async def _scheduled(
    session: AsyncSession, order: Order, actor: User | None
) -> None:
    if order.status in (OrderStatus.created, OrderStatus.exception):
        await transition_order(session, order.id, OrderStatus.scheduled, actor=actor)


async def _exception(
    session: AsyncSession, order: Order, actor: User | None, reason: str
) -> None:
    await _scheduled(session, order, actor)
    if order.status == OrderStatus.scheduled:
        await transition_order(
            session,
            order.id,
            OrderStatus.exception,
            actor=actor,
            meta={"reason": reason},
        )


class DispatchService:
    def __init__(self, session: AsyncSession, redis: Redis) -> None:
        self.session = session
        self.redis = redis

    def _bus(self) -> EventBus:
        configured = self.session.info.get("event_bus")
        return configured if isinstance(configured, EventBus) else EventBus(self.redis)

    async def create_job(
        self,
        service_date: date,
        district: str,
        config_overrides: dict[str, Any],
        actor: User,
    ) -> uuid.UUID:
        repository = RoutingJobsRepository(self.session)
        await _scope_lock(self.session, service_date, district)
        if await repository.running(service_date, district) is not None:
            await self.session.rollback()
            raise DispatchServiceError("a dispatch job is already running", 409)
        job = repository.add(
            RoutingJob(
                service_date=service_date,
                district=district,
                status=RoutingJobStatus.queued,
                params={
                    "config_overrides": config_overrides,
                    "actor_id": str(actor.id),
                },
            )
        )
        await self.session.commit()
        await self.session.refresh(job)
        arq = ArqRedis(self.redis.connection_pool)
        queued = await arq.enqueue_job("run_dispatch_job", str(job.id))
        if queued is None:
            job.status = RoutingJobStatus.failed
            job.error = "could not enqueue dispatch job"
            job.finished_at = datetime.now(UTC)
            await self.session.commit()
            raise DispatchServiceError("could not enqueue dispatch job", 503)
        return job.id

    async def insert(self, order_id: uuid.UUID, actor: User) -> DispatchInsertResult:
        order = await OrdersRepository(self.session).get_for_update(order_id)
        if order is None:
            raise DispatchServiceError("order not found", 404)
        plan = await PlansRepository(self.session).published_for_date(order.service_date)
        if plan is None:
            raise DispatchServiceError("published plan not found", 404)
        plan = await PlansRepository(self.session).get_for_update(plan.id)
        assert plan is not None
        assignments = await PlansRepository(self.session).assignments(plan.id)
        if any(order.id in row.order_ids for row in assignments):
            raise DispatchServiceError("order is already in the published plan")
        existing_ids = {item for row in assignments for item in row.order_ids}
        existing_orders = list(
            await self.session.scalars(select(Order).where(Order.id.in_(existing_ids)))
        )
        driver_ids = {row.driver_id for row in assignments}
        drivers = list(
            await self.session.scalars(
                select(Driver).where(
                    or_(
                        Driver.user_id.in_(driver_ids),
                        (Driver.region == plan.district) & Driver.is_online.is_(True),
                    )
                )
            )
        )
        driver_ids = {driver.user_id for driver in drivers}
        combined = adapt_dispatch(
            [*existing_orders, order],
            drivers,
            plan.district,
            (plan.stats or {}).get("config_overrides", {}),
        )
        new_engine_id = combined.representative_by_order.get(order.id)
        if new_engine_id is None:
            await _exception(self.session, order, actor, "invalid order coordinates")
            await self.session.commit()
            await self._bus().publish(
                f"dispatch:{plan.district}",
                event(
                    "order.exception",
                    OrderExceptionPayload(
                        order_id=order.id, reason="invalid order coordinates"
                    ),
                ),
            )
            return DispatchInsertResult(
                placed=False, reason="invalid order coordinates", plan_id=plan.id
            )
        current = await PlansService(self.session)._current_solution(plan)
        new_order = next(item for item in combined.orders if item.id == new_engine_id)
        positions = await get_driver_positions(self.redis, list(driver_ids))
        position_map = {
            str(item.driver_id): DriverPosition(
                item.lat,
                item.lon,
                (
                    item.ts.hour * 60 + item.ts.minute + item.ts.second / 60
                    if item.ts.date() == plan.service_date
                    else 0.0
                ),
            )
            for item in positions
        }
        result = online_insert(current, new_order, position_map)
        if new_engine_id in result.unassigned:
            await _exception(self.session, order, actor, UNASSIGNED_REASON)
            if plan.routing_job_id is not None:
                job = await self.session.get(RoutingJob, plan.routing_job_id)
                if job is not None:
                    job.unassigned_order_ids = sorted(
                        set(job.unassigned_order_ids or []) | {order.id}, key=str
                    )
            await self.session.commit()
            await self._bus().publish(
                f"dispatch:{plan.district}",
                event(
                    "order.exception",
                    OrderExceptionPayload(order_id=order.id, reason=UNASSIGNED_REASON),
                ),
            )
            return DispatchInsertResult(
                placed=False, reason=UNASSIGNED_REASON, plan_id=plan.id
            )
        await persist_solution(self.session, plan, result, combined)
        await _scheduled(self.session, order, actor)
        await transition_order(self.session, order.id, OrderStatus.assigned, actor=actor)
        driver_id = next(
            uuid.UUID(item)
            for item, blocks in result.routes.items()
            if any(new_engine_id in block.order_ids for block in blocks)
        )
        await self.session.commit()
        await self._bus().publish(
            f"driver:{driver_id}",
            event(
                "route.updated",
                RouteUpdatedPayload(plan_id=plan.id, reason="order inserted"),
            ),
        )
        return DispatchInsertResult(
            placed=True, plan_id=plan.id, driver_id=driver_id
        )


@_observe_dispatch_job
async def run_dispatch_job(ctx: dict[str, Any], job_id: str) -> bool:
    """ARQ entrypoint. A failed calculation never mutates orders or creates a draft."""
    session_factory: async_sessionmaker[Any] = ctx["session_factory"]
    parsed_id = uuid.UUID(job_id)
    async with session_factory() as session:
        repository = RoutingJobsRepository(session)
        job = await repository.get_for_update(parsed_id)
        if job is None:
            logger.warning("dispatch_job.not_found", job_id=job_id)
            return False
        if job.status != RoutingJobStatus.queued:
            return job.status == RoutingJobStatus.done
        await _scope_lock(session, job.service_date, job.district)
        running = await repository.running(job.service_date, job.district)
        if running is not None and running.id != job.id:
            job.status = RoutingJobStatus.failed
            job.error = "another dispatch job is already running"
            job.finished_at = datetime.now(UTC)
            await session.commit()
            return False
        job.status = RoutingJobStatus.running
        job.started_at = datetime.now(UTC)
        await session.commit()

        try:
            job = await repository.get(parsed_id)
            assert job is not None
            orders = await OrdersRepository(session).list_for_dispatch(
                job.service_date,
                exclude_planned_in_other_districts=job.district,
            )
            drivers = await DriversRepository(session).list(
                region=job.district, is_online=True, limit=10000
            )
            params = job.params or {}
            adapted = adapt_dispatch(
                orders,
                drivers,
                job.district,
                params.get("config_overrides", {}),
            )
            solution = solve(adapted.orders, adapted.drivers, adapted.config)
            unassigned_ids = set(adapted.rejected_order_ids)
            for engine_id in solution.unassigned:
                unassigned_ids.update(adapted.expand(engine_id))
            assigned_ids = {
                order_id
                for blocks in solution.routes.values()
                for block in blocks
                for engine_id in block.order_ids
                for order_id in adapted.expand(engine_id)
            }
            actor_id = params.get("actor_id")
            actor = await session.get(User, uuid.UUID(actor_id)) if actor_id else None
            bug_report = _issues(solution)
            product_stats = {
                **asdict(solution.stats),
                "total_orders": len(orders),
                "assigned_orders": len(assigned_ids),
                "unassigned_orders": len(unassigned_ids),
                "engine_units": solution.stats.total_orders,
            }
            plan = RoutePlan(
                service_date=job.service_date,
                district=job.district,
                status=PlanStatus.draft,
                needs_review=bool(bug_report),
                stats={
                    **product_stats,
                    "anomalies": adapted.anomalies,
                    "config_overrides": params.get("config_overrides", {}),
                },
                created_by=actor.id if actor is not None else None,
                routing_job_id=job.id,
            )
            session.add(plan)
            await session.flush()
            await persist_solution(session, plan, solution, adapted)
            by_id = {item.id: item for item in orders}
            for order_id in sorted(assigned_ids, key=str):
                await _scheduled(session, by_id[order_id], actor)
            for order_id in sorted(unassigned_ids, key=str):
                await _exception(session, by_id[order_id], actor, UNASSIGNED_REASON)
            job.status = RoutingJobStatus.done
            job.result_stats = {
                **product_stats,
                "anomalies": adapted.anomalies,
            }
            job.unassigned_order_ids = sorted(unassigned_ids, key=str)
            job.bug_report = bug_report
            job.error = None
            job.finished_at = datetime.now(UTC)
            await session.commit()
            configured = session.info.get("event_bus")
            bus = configured if isinstance(configured, EventBus) else EventBus(ctx["redis"])
            await bus.publish(
                f"dispatch:{job.district}",
                event(
                    "plan.draft_ready",
                    PlanDraftReadyPayload(plan_id=plan.id, district=job.district),
                ),
            )
            for order_id in unassigned_ids:
                await bus.publish(
                    f"dispatch:{job.district}",
                    event(
                        "order.exception",
                        OrderExceptionPayload(order_id=order_id, reason=UNASSIGNED_REASON),
                    ),
                )
            logger.info("dispatch_job.done", job_id=job_id, plan_id=str(plan.id))
            return True
        except Exception as exc:
            await session.rollback()
            failed = await repository.get_for_update(parsed_id)
            if failed is not None:
                failed.status = RoutingJobStatus.failed
                failed.error = str(exc)[:4000]
                failed.finished_at = datetime.now(UTC)
                await session.commit()
            logger.exception("dispatch_job.failed", job_id=job_id)
            return False
