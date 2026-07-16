"""Draft plan editing, validation and publication."""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, NoReturn

import structlog
from redis.asyncio import Redis
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.enums import AssignmentKind, OrderStatus, PlanStatus
from app.domain.models import (
    Driver,
    DriverLunch,
    Order,
    RouteAssignment,
    RoutePlan,
    RoutingJob,
    User,
)
from app.domain.repositories import PlansRepository
from app.domain.schemas import (
    PlanBlockOut,
    PlanDriverOut,
    PlanExceptionOut,
    PlanLunchOut,
    PlanOut,
    PlanStopOut,
    PlanSummaryOut,
    ValidationIssueOut,
    ValidationReportOut,
)
from app.realtime.events import (
    OrderExceptionPayload,
    PlanPublishedPayload,
    RoutePublishedPayload,
    RouteUpdatedPayload,
    event,
)
from app.services.dispatch_adapter import AdaptedDispatch, adapt_dispatch
from app.services.event_bus import EventBus
from app.services.order_state import transition_order
from routing import (
    Block,
    Lunch,
    Solution,
    SolutionStats,
    Stop,
    ValidationReport,
    solve,
    validate,
)

logger = structlog.get_logger(__name__)


class PlanServiceError(Exception):
    def __init__(self, message: str, status_code: int = 409) -> None:
        self.status_code = status_code
        super().__init__(message)


def _at_minute(service_date: date, minute: float) -> datetime:
    return datetime.combine(service_date, time.min, tzinfo=UTC) + timedelta(minutes=minute)


def _stop_rows(stops: tuple[Stop, ...], adapted: AdaptedDispatch) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for stop in stops:
        for order_id in adapted.expand(stop.order_id):
            rows.append(
                {
                    "order_id": str(order_id),
                    "lat": stop.lat,
                    "lon": stop.lon,
                    "time": stop.time,
                }
            )
    return rows


def _assignment_rows(
    plan: RoutePlan,
    driver_id: str,
    blocks: list[Block],
    adapted: AdaptedDispatch,
) -> list[RouteAssignment]:
    result: list[RouteAssignment] = []
    for seq, block in enumerate(blocks, start=1):
        order_ids = [item for engine_id in block.order_ids for item in adapted.expand(engine_id)]
        result.append(
            RouteAssignment(
                plan_id=plan.id,
                driver_id=uuid.UUID(driver_id),
                seq=seq,
                kind=AssignmentKind(block.kind),
                order_ids=order_ids,
                planned_pickup_at=_at_minute(plan.service_date, block.start_time),
                planned_dropoff_at=_at_minute(plan.service_date, block.end_time),
                pickup_seq=_stop_rows(block.pickup_seq, adapted),
                dropoff_seq=_stop_rows(block.dropoff_seq, adapted),
            )
        )
    return result


async def persist_solution(
    session: AsyncSession,
    plan: RoutePlan,
    solution: Solution,
    adapted: AdaptedDispatch,
) -> None:
    """Replace all route details for a plan without committing."""
    repository = PlansRepository(session)
    await repository.delete_assignments(plan.id)
    await repository.delete_lunches(plan.id)
    for driver_id, blocks in solution.routes.items():
        session.add_all(_assignment_rows(plan, driver_id, blocks, adapted))
    for driver_id, lunch in solution.lunches.items():
        if driver_id.startswith("RENT"):
            continue
        session.add(
            DriverLunch(
                plan_id=plan.id,
                driver_id=uuid.UUID(driver_id),
                start_min=round(lunch.start_min),
                end_min=round(lunch.end_min),
                is_full=lunch.full,
            )
        )
    await session.flush()


async def _transition_to_exception(
    session: AsyncSession, order: Order, actor: User | None, reason: str
) -> None:
    if order.status == OrderStatus.created:
        await transition_order(session, order.id, OrderStatus.scheduled, actor=actor)
    if order.status in (OrderStatus.scheduled, OrderStatus.assigned):
        await transition_order(
            session,
            order.id,
            OrderStatus.exception,
            actor=actor,
            meta={"reason": reason},
        )


def _report_out(solution: Solution) -> ValidationReportOut:
    return ValidationReportOut(
        is_valid=solution.validation.is_valid,
        issues=[
            ValidationIssueOut(
                code=issue.code,
                message=issue.message,
                driver_id=issue.driver_id,
                order_id=issue.order_id,
            )
            for issue in solution.validation.issues
        ],
    )


class PlansService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repository = PlansRepository(session)

    async def list_plans(
        self, *, service_date: date | None, district: str | None
    ) -> list[PlanSummaryOut]:
        plans = await self.repository.list(service_date=service_date, district=district)
        return [
            PlanSummaryOut(
                id=plan.id,
                service_date=plan.service_date,
                district=plan.district,
                status=plan.status,
                needs_review=plan.needs_review,
                stats=plan.stats,
                routing_job_id=plan.routing_job_id,
                created_at=plan.created_at,
                published_at=plan.published_at,
            )
            for plan in plans
        ]

    async def _require(self, plan_id: uuid.UUID, *, draft: bool = False) -> RoutePlan:
        plan = (
            await self.repository.get_for_update(plan_id)
            if draft
            else await self.repository.get(plan_id)
        )
        if plan is None:
            raise PlanServiceError("plan not found", 404)
        if draft and plan.status != PlanStatus.draft:
            raise PlanServiceError("only a draft plan can be edited")
        return plan

    async def get(self, plan_id: uuid.UUID) -> PlanOut:
        plan = await self._require(plan_id)
        assignments = await self.repository.assignments(plan.id)
        lunches = {item.driver_id: item for item in await self.repository.lunches(plan.id)}
        assigned_ids = {item for row in assignments for item in row.order_ids}
        unassigned_ids: set[uuid.UUID] = set()
        if plan.routing_job_id is not None:
            job = await self.session.get(RoutingJob, plan.routing_job_id)
            unassigned_ids.update(job.unassigned_order_ids or [] if job else [])
        all_ids = assigned_ids | unassigned_ids
        orders = {
            item.id: item
            for item in await self.session.scalars(select(Order).where(Order.id.in_(all_ids)))
        }
        by_driver: defaultdict[uuid.UUID, list[PlanBlockOut]] = defaultdict(list)
        for assignment in assignments:
            pickup = self._stops_out(assignment.pickup_seq, orders)
            dropoff = self._stops_out(assignment.dropoff_seq, orders)
            by_driver[assignment.driver_id].append(
                PlanBlockOut(
                    seq=assignment.seq,
                    kind=assignment.kind,
                    order_ids=assignment.order_ids,
                    desired_times={
                        str(item): orders[item].desired_time
                        for item in assignment.order_ids
                        if item in orders
                    },
                    planned_pickup_at=assignment.planned_pickup_at,
                    planned_dropoff_at=assignment.planned_dropoff_at,
                    pickup_seq=pickup,
                    dropoff_seq=dropoff,
                )
            )
        driver_rows = [
            PlanDriverOut(
                driver_id=driver_id,
                blocks=by_driver.get(driver_id, []),
                lunch=(
                    PlanLunchOut(
                        start_min=lunches[driver_id].start_min,
                        end_min=lunches[driver_id].end_min,
                        is_full=lunches[driver_id].is_full,
                    )
                    if driver_id in lunches
                    else None
                ),
            )
            for driver_id in sorted(set(by_driver) | set(lunches), key=str)
        ]
        exceptions = [
            PlanExceptionOut(
                order_id=order_id,
                desired_time=orders[order_id].desired_time,
                reason="не влез в парк ±15 мин",
            )
            for order_id in sorted(unassigned_ids, key=str)
            if order_id in orders
        ]
        return PlanOut(
            id=plan.id,
            service_date=plan.service_date,
            district=plan.district,
            status=plan.status,
            needs_review=plan.needs_review,
            stats=plan.stats,
            routing_job_id=plan.routing_job_id,
            created_at=plan.created_at,
            published_at=plan.published_at,
            drivers=driver_rows,
            exceptions=exceptions,
        )

    @staticmethod
    def _stops_out(
        values: list[Any] | None, orders: dict[uuid.UUID, Order]
    ) -> list[PlanStopOut]:
        result: list[PlanStopOut] = []
        for value in values or []:
            order_id = uuid.UUID(value["order_id"])
            order = orders.get(order_id)
            if order is not None:
                result.append(
                    PlanStopOut(
                        order_id=order_id,
                        lat=float(value["lat"]),
                        lon=float(value["lon"]),
                        desired_time=order.desired_time,
                        calculated_min=float(value["time"]),
                    )
                )
        return result

    async def _plan_inputs(
        self, plan: RoutePlan
    ) -> tuple[list[RouteAssignment], list[Order], list[Driver], AdaptedDispatch]:
        assignments = await self.repository.assignments(plan.id)
        order_ids = {item for row in assignments for item in row.order_ids}
        orders = list(
            await self.session.scalars(select(Order).where(Order.id.in_(order_ids)))
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
        config = (plan.stats or {}).get("config_overrides", {})
        return assignments, orders, drivers, adapt_dispatch(orders, drivers, plan.district, config)

    @staticmethod
    def _fail_move(reason: str) -> NoReturn:
        raise PlanServiceError(reason, 422)

    async def move(
        self,
        plan_id: uuid.UUID,
        order_id: uuid.UUID,
        to_driver_id: uuid.UUID,
        position: int | None,
    ) -> PlanOut:
        plan = await self._require(plan_id, draft=True)
        assignments, orders, drivers, adapted = await self._plan_inputs(plan)
        source = next(
            (row.driver_id for row in assignments if order_id in row.order_ids), None
        )
        if source is None:
            raise PlanServiceError("order is not assigned in this plan", 404)
        target_driver = await self.session.get(Driver, to_driver_id)
        if target_driver is None or target_driver.region != plan.district:
            raise PlanServiceError("target driver is not available in this district", 422)
        if all(item.user_id != to_driver_id for item in drivers):
            drivers.append(target_driver)
            adapted = adapt_dispatch(
                orders,
                drivers,
                plan.district,
                (plan.stats or {}).get("config_overrides", {}),
            )
        representative = adapted.representative_by_order.get(order_id)
        if representative is None:
            self._fail_move("order has invalid coordinates")
        route_ids: defaultdict[uuid.UUID, list[str]] = defaultdict(list)
        for row in assignments:
            for item in row.order_ids:
                engine_id = adapted.representative_by_order.get(item)
                if engine_id is not None and engine_id not in route_ids[row.driver_id]:
                    route_ids[row.driver_id].append(engine_id)
        route_ids[source] = [item for item in route_ids[source] if item != representative]
        target = route_ids[to_driver_id]
        target = [item for item in target if item != representative]
        index = len(target) if position is None else min(position, len(target))
        target.insert(index, representative)
        route_ids[to_driver_id] = target

        engine_orders = {item.id: item for item in adapted.orders}
        engine_drivers = {item.id: item for item in adapted.drivers}
        rebuilt: dict[uuid.UUID, Solution] = {}
        for driver_id in {source, to_driver_id}:
            ids = route_ids[driver_id]
            if not ids:
                continue
            result = solve(
                [engine_orders[item] for item in ids],
                [engine_drivers[str(driver_id)]],
                adapted.config,
            )
            if result.unassigned or not result.validation.is_valid:
                issue = result.validation.issues[0].message if result.validation.issues else None
                self._fail_move(issue or "target route violates time windows or capacity")
            rebuilt[driver_id] = result

        # All trial computation happened before the first plan mutation.
        changed_driver_ids = {source, to_driver_id}
        for driver_id in changed_driver_ids:
            for row in assignments:
                if row.driver_id == driver_id:
                    await self.session.delete(row)
            lunch = await self.session.get(DriverLunch, (plan.id, driver_id))
            if lunch is not None:
                await self.session.delete(lunch)
        await self.session.flush()
        for driver_id in changed_driver_ids:
            current_result = rebuilt.get(driver_id)
            if current_result is not None:
                self.session.add_all(
                    _assignment_rows(
                        plan,
                        str(driver_id),
                        current_result.routes[str(driver_id)],
                        adapted,
                    )
                )
                new_lunch = current_result.lunches.get(str(driver_id))
                if new_lunch is not None:
                    self.session.add(
                        DriverLunch(
                            plan_id=plan.id,
                            driver_id=driver_id,
                            start_min=round(new_lunch.start_min),
                            end_min=round(new_lunch.end_min),
                            is_full=new_lunch.full,
                        )
                    )
        await self.session.commit()
        configured_bus = self.session.info.get("event_bus")
        if isinstance(configured_bus, EventBus):
            for changed_driver_id in changed_driver_ids:
                await configured_bus.publish(
                    f"driver:{changed_driver_id}",
                    event(
                        "route.updated",
                        RouteUpdatedPayload(plan_id=plan.id, reason="order moved"),
                    ),
                )
        return await self.get(plan.id)

    async def unassign(
        self, plan_id: uuid.UUID, order_id: uuid.UUID, actor: User
    ) -> PlanOut:
        plan = await self._require(plan_id, draft=True)
        order = await self.session.get(Order, order_id)
        if order is None:
            raise PlanServiceError("order not found", 404)
        group_ids = {order_id}
        if order.twin_group_id is not None:
            group_ids.update(
                await self.session.scalars(
                    select(Order.id).where(Order.twin_group_id == order.twin_group_id)
                )
            )
        assignments = await self.repository.assignments(plan.id)
        affected = [row for row in assignments if group_ids.intersection(row.order_ids)]
        if not affected:
            raise PlanServiceError("order is not assigned in this plan", 404)
        for row in affected:
            remaining = [item for item in row.order_ids if item not in group_ids]
            if not remaining:
                await self.session.delete(row)
            else:
                row.order_ids = remaining
                row.pickup_seq = [
                    item
                    for item in row.pickup_seq or []
                    if uuid.UUID(item["order_id"]) not in group_ids
                ]
                row.dropoff_seq = [
                    item
                    for item in row.dropoff_seq or []
                    if uuid.UUID(item["order_id"]) not in group_ids
                ]
        for item in await self.session.scalars(select(Order).where(Order.id.in_(group_ids))):
            await _transition_to_exception(
                self.session, item, actor, "не влез в парк ±15 мин"
            )
        if plan.routing_job_id is not None:
            job = await self.session.get(RoutingJob, plan.routing_job_id)
            if job is not None:
                job.unassigned_order_ids = sorted(
                    set(job.unassigned_order_ids or []) | group_ids, key=str
                )
        await self.session.commit()
        configured_bus = self.session.info.get("event_bus")
        if isinstance(configured_bus, EventBus):
            for unassigned_id in group_ids:
                await configured_bus.publish(
                    f"dispatch:{plan.district}",
                    event(
                        "order.exception",
                        OrderExceptionPayload(
                            order_id=unassigned_id,
                            reason="не влез в парк ±15 мин",
                        ),
                    ),
                )
        return await self.get(plan.id)

    async def _current_solution(self, plan: RoutePlan) -> Solution:
        assignments, _orders, _drivers, adapted = await self._plan_inputs(plan)
        routes: defaultdict[str, list[Block]] = defaultdict(list)
        for row in assignments:
            order_ids: list[str] = []
            for item in row.order_ids:
                representative = adapted.representative_by_order.get(item)
                if representative is not None and representative not in order_ids:
                    order_ids.append(representative)
            pickup = self._collapsed_stops(row.pickup_seq, adapted)
            dropoff = self._collapsed_stops(row.dropoff_seq, adapted)
            routes[str(row.driver_id)].append(
                Block(
                    row.kind.value,
                    tuple(order_ids),
                    pickup,
                    dropoff,
                    min((item.time for item in pickup), default=0.0),
                    max((item.time for item in dropoff), default=0.0),
                )
            )
        lunches = {
            str(item.driver_id): Lunch(item.start_min, item.end_min, item.is_full)
            for item in await self.repository.lunches(plan.id)
        }
        order_map = {item.id: item for item in adapted.orders}
        driver_map = {item.id: item for item in adapted.drivers}
        solution = Solution(
            dict(routes),
            lunches,
            set(),
            ValidationReport(),
            SolutionStats(
                total_orders=len(order_map),
                assigned_orders=len(order_map),
                unassigned_orders=0,
                active_drivers=sum(bool(blocks) for blocks in routes.values()),
                rental_drivers=0,
            ),
            order_map,
            driver_map,
            adapted.config,
        )
        solution.validation = validate(solution)
        return solution

    @staticmethod
    def _collapsed_stops(
        values: list[Any] | None, adapted: AdaptedDispatch
    ) -> tuple[Stop, ...]:
        result: list[Stop] = []
        seen: set[str] = set()
        for value in values or []:
            representative = adapted.representative_by_order.get(uuid.UUID(value["order_id"]))
            if representative is not None and representative not in seen:
                seen.add(representative)
                result.append(
                    Stop(
                        representative,
                        float(value["lat"]),
                        float(value["lon"]),
                        float(value["time"]),
                    )
                )
        return tuple(result)

    async def revalidate(self, plan_id: uuid.UUID) -> ValidationReportOut:
        plan = await self._require(plan_id)
        solution = await self._current_solution(plan)
        report = validate(solution)
        solution.validation = report
        plan.needs_review = not report.is_valid
        await self.session.commit()
        return _report_out(solution)

    async def publish(
        self, plan_id: uuid.UUID, actor: User, redis: Redis, *, force: bool
    ) -> PlanOut:
        plan = await self._require(plan_id, draft=True)
        if plan.needs_review and not force:
            raise PlanServiceError("plan needs review; pass force=true to publish", 409)
        if force:
            logger.warning("plan.force_published", plan_id=str(plan.id), actor_id=str(actor.id))
            plan.stats = {**(plan.stats or {}), "force_published_by": str(actor.id)}
        previous = list(
            await self.session.scalars(
                select(RoutePlan).where(
                    RoutePlan.service_date == plan.service_date,
                    RoutePlan.district == plan.district,
                    RoutePlan.status == PlanStatus.published,
                    RoutePlan.id != plan.id,
                )
            )
        )
        for item in previous:
            item.status = PlanStatus.archived
        assignments = await self.repository.assignments(plan.id)
        order_ids = {item for row in assignments for item in row.order_ids}
        orders = {
            item.id: item
            for item in await self.session.scalars(select(Order).where(Order.id.in_(order_ids)))
        }
        for order in orders.values():
            if order.status == OrderStatus.created:
                await transition_order(
                    session=self.session,
                    order_id=order.id,
                    to_status=OrderStatus.scheduled,
                    actor=actor,
                )
            if order.status == OrderStatus.exception:
                await transition_order(self.session, order.id, OrderStatus.scheduled, actor=actor)
            if order.status == OrderStatus.scheduled:
                await transition_order(self.session, order.id, OrderStatus.assigned, actor=actor)
        plan.status = PlanStatus.published
        plan.published_at = datetime.now(UTC)
        await self.session.commit()
        configured_bus = self.session.info.get("event_bus")
        bus = configured_bus if isinstance(configured_bus, EventBus) else EventBus(redis)

        by_driver: defaultdict[uuid.UUID, list[RouteAssignment]] = defaultdict(list)
        for assignment in assignments:
            by_driver[assignment.driver_id].append(assignment)
        for driver_id, rows in by_driver.items():
            payload = RoutePublishedPayload(
                plan_id=plan.id,
                service_date=plan.service_date,
                orders=[
                    {
                        "order_id": str(order_id),
                        "desired_time": orders[order_id].desired_time.isoformat(),
                    }
                    for row in rows
                    for order_id in row.order_ids
                    if order_id in orders
                ],
            )
            await bus.publish(f"driver:{driver_id}", event("route.published", payload))
        await bus.publish(
            f"dispatch:{plan.district}",
            event(
                "plan.published",
                PlanPublishedPayload(
                    plan_id=plan.id,
                    service_date=plan.service_date,
                    district=plan.district,
                ),
            ),
        )
        return await self.get(plan.id)
