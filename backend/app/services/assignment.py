"""Immediate manual/automatic assignment used by the dispatcher UI."""

import uuid
from datetime import UTC, datetime

from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.enums import AssignmentKind, OrderStatus, PlanStatus
from app.domain.models import Driver, RouteAssignment, RoutePlan, User
from app.domain.repositories import DriversRepository, OrdersRepository, PlansRepository
from app.domain.schemas import (
    AssignedDriverOut,
    AssignOrderResponse,
    DispatchCandidateOut,
    DispatchCandidatesOut,
    OrderOut,
)
from app.realtime.events import PlanPublishedPayload, RoutePublishedPayload, event
from app.services.event_bus import EventBus
from app.services.order_state import OrderStateError, transition_order


class AssignmentServiceError(Exception):
    def __init__(self, message: str, status_code: int = 409) -> None:
        self.status_code = status_code
        super().__init__(message)


class AssignmentService:
    def __init__(self, session: AsyncSession, redis: Redis) -> None:
        self.session = session
        self.redis = redis
        self.orders = OrdersRepository(session)

    async def candidates(self, order_id: uuid.UUID) -> DispatchCandidatesOut:
        order = await self.orders.get(order_id)
        if order is None:
            raise AssignmentServiceError("order not found", 404)
        if order.status in (OrderStatus.completed, OrderStatus.cancelled):
            raise AssignmentServiceError("completed or cancelled order cannot be assigned")
        drivers = await DriversRepository(self.session).list(limit=200)
        drivers = [driver for driver in drivers if driver.capacity >= order.seats]
        assignments = list(
            await self.session.scalars(
                select(RouteAssignment)
                .join(RoutePlan, RoutePlan.id == RouteAssignment.plan_id)
                .where(
                    RoutePlan.status == PlanStatus.published,
                    RoutePlan.service_date == order.service_date,
                )
            )
        )
        workload: dict[uuid.UUID, int] = {}
        for assignment in assignments:
            workload[assignment.driver_id] = (
                workload.get(assignment.driver_id, 0) + len(assignment.order_ids)
            )
        drivers.sort(
            key=lambda driver: (
                not driver.is_online,
                workload.get(driver.user_id, 0),
                driver.full_name.casefold(),
            )
        )
        values = [
            DispatchCandidateOut(
                driver_id=driver.user_id,
                name=driver.full_name,
                region_id=driver.region,
                car_model=driver.vehicle_model,
                capacity=driver.capacity,
                is_online=driver.is_online,
                priority={
                    "region_match": True,
                    "order_count": workload.get(driver.user_id, 0),
                    "distance": None,
                },
            )
            for driver in drivers
        ]
        return DispatchCandidatesOut(order_id=order.id, candidates=values, count=len(values))

    async def assign(
        self, order_id: uuid.UUID, requested_driver_id: uuid.UUID | None, actor: User
    ) -> AssignOrderResponse:
        order = await self.orders.get_for_update(order_id)
        if order is None:
            raise AssignmentServiceError("order not found", 404)
        if order.status not in (
            OrderStatus.created,
            OrderStatus.scheduled,
            OrderStatus.exception,
        ):
            raise AssignmentServiceError(f"order in status {order.status.value} cannot be assigned")
        existing = await self.orders.get_assigned_driver_id(order.id)
        if existing is not None:
            raise AssignmentServiceError("order is already assigned")

        if None in (
            order.pickup_lat,
            order.pickup_lon,
            order.dropoff_lat,
            order.dropoff_lon,
        ):
            raise AssignmentServiceError("order coordinates are required for assignment", 422)
        candidates = (await self.candidates(order.id)).candidates
        if requested_driver_id is None:
            selected = next((item for item in candidates if item.is_online), None)
            if selected is None:
                raise AssignmentServiceError("no online driver with enough capacity", 422)
            driver_id = selected.driver_id
        else:
            driver_id = requested_driver_id
            if all(item.driver_id != driver_id for item in candidates):
                raise AssignmentServiceError("driver is unavailable for this order", 422)
        driver = await self.session.get(Driver, driver_id)
        if driver is None:
            raise AssignmentServiceError("driver not found", 404)
        if driver.capacity < order.seats:
            raise AssignmentServiceError("driver does not have enough capacity", 422)

        plans = PlansRepository(self.session)
        plan = await plans.published_for_date(order.service_date, driver.region)
        created_plan = plan is None
        if plan is None:
            plan = RoutePlan(
                service_date=order.service_date,
                district=driver.region,
                status=PlanStatus.published,
                published_at=datetime.now(UTC),
                created_by=actor.id,
                stats={"source": "immediate_assignment"},
            )
            self.session.add(plan)
            await self.session.flush()
        else:
            plan = await plans.get_for_update(plan.id)
            assert plan is not None
        plan.stats = {**(plan.stats or {}), "contains_immediate_assignments": True}

        seq = int(
            await self.session.scalar(
                select(func.max(RouteAssignment.seq)).where(
                    RouteAssignment.plan_id == plan.id,
                    RouteAssignment.driver_id == driver.user_id,
                )
            )
            or 0
        ) + 1
        self.session.add(
            RouteAssignment(
                plan_id=plan.id,
                driver_id=driver.user_id,
                seq=seq,
                kind=AssignmentKind.trip,
                order_ids=[order.id],
                pickup_seq=[
                    {
                        "order_id": str(order.id),
                        "lat": order.pickup_lat,
                        "lon": order.pickup_lon,
                        "time": order.desired_time.hour * 60 + order.desired_time.minute,
                    }
                ],
                dropoff_seq=[
                    {
                        "order_id": str(order.id),
                        "lat": order.dropoff_lat,
                        "lon": order.dropoff_lon,
                        "time": order.desired_time.hour * 60 + order.desired_time.minute,
                    }
                ],
            )
        )
        try:
            if order.status == OrderStatus.exception:
                await transition_order(self.session, order.id, OrderStatus.scheduled, actor=actor)
            if order.status == OrderStatus.created:
                await transition_order(self.session, order.id, OrderStatus.scheduled, actor=actor)
            await transition_order(
                self.session,
                order.id,
                OrderStatus.assigned,
                actor=actor,
                meta={
                    "driver_id": str(driver.user_id),
                    "assignment": (
                        "automatic" if requested_driver_id is None else "manual"
                    ),
                },
            )
        except OrderStateError as exc:
            raise AssignmentServiceError(str(exc), exc.status_code) from exc
        await self.session.commit()
        await self.session.refresh(order)

        configured = self.session.info.get("event_bus")
        bus = configured if isinstance(configured, EventBus) else EventBus(self.redis)
        await bus.publish(
            f"driver:{driver.user_id}",
            event(
                "route.published",
                RoutePublishedPayload(
                    plan_id=plan.id,
                    service_date=plan.service_date,
                    orders=[
                        {
                            "order_id": str(order.id),
                            "desired_time": order.desired_time.isoformat(),
                        }
                    ],
                ),
            ),
        )
        if created_plan:
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
        user = await self.session.get(User, driver.user_id)
        output = OrderOut.model_validate(order)
        output.assigned_driver = AssignedDriverOut(
            id=driver.user_id,
            name=driver.full_name,
            car_model=driver.vehicle_model,
            plate_number=driver.plate,
            phone=user.phone if user else None,
        )
        return AssignOrderResponse(
            success=True,
            driver_id=driver.user_id,
            auto_assigned=requested_driver_id is None,
            order=output,
        )
