"""Thin async repositories: query/persist only, no business logic."""
import builtins
import uuid
from datetime import date

from sqlalchemy import delete, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.enums import OrderStatus, PlanStatus, RoutingJobStatus, UserStatus
from app.domain.models import (
    Driver,
    DriverLunch,
    Order,
    RouteAssignment,
    RoutePlan,
    RoutingJob,
    User,
)


class OrdersRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, order_id: uuid.UUID) -> Order | None:
        return await self.session.get(Order, order_id)

    async def get_for_update(self, order_id: uuid.UUID) -> Order | None:
        result = await self.session.scalars(
            select(Order).where(Order.id == order_id).with_for_update()
        )
        return result.one_or_none()

    async def list(
        self,
        *,
        service_date: date | None = None,
        service_date_from: date | None = None,
        service_date_to: date | None = None,
        status: OrderStatus | None = None,
        client_id: uuid.UUID | None = None,
        district: str | None = None,
        driver_id: uuid.UUID | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Order]:
        stmt = select(Order).order_by(Order.service_date, Order.desired_time)
        if service_date is not None:
            stmt = stmt.where(Order.service_date == service_date)
        if service_date_from is not None:
            stmt = stmt.where(Order.service_date >= service_date_from)
        if service_date_to is not None:
            stmt = stmt.where(Order.service_date <= service_date_to)
        if status is not None:
            stmt = stmt.where(Order.status == status)
        if client_id is not None:
            stmt = stmt.where(Order.client_id == client_id)
        if district is not None:
            stmt = stmt.where(
                select(RouteAssignment.id)
                .join(RoutePlan, RoutePlan.id == RouteAssignment.plan_id)
                .where(
                    RoutePlan.status == PlanStatus.published,
                    RoutePlan.district == district,
                    Order.id == RouteAssignment.order_ids.any_(),
                )
                .exists()
            )
        if driver_id is not None:
            stmt = stmt.where(
                select(RouteAssignment.id)
                .join(RoutePlan, RoutePlan.id == RouteAssignment.plan_id)
                .where(
                    RoutePlan.status == PlanStatus.published,
                    RouteAssignment.driver_id == driver_id,
                    Order.id == RouteAssignment.order_ids.any_(),
                )
                .exists()
            )
        result = await self.session.scalars(stmt.limit(limit).offset(offset))
        return list(result)

    async def driver_can_access(self, order_id: uuid.UUID, driver_id: uuid.UUID) -> bool:
        stmt = (
            select(RouteAssignment.id)
            .join(RoutePlan, RoutePlan.id == RouteAssignment.plan_id)
            .where(
                RoutePlan.status == PlanStatus.published,
                RouteAssignment.driver_id == driver_id,
                literal(order_id) == RouteAssignment.order_ids.any_(),
            )
            .limit(1)
        )
        return (await self.session.scalar(stmt)) is not None

    async def count_active(self, client_id: uuid.UUID, service_date: date) -> int:
        terminal = (OrderStatus.completed, OrderStatus.cancelled)
        stmt = select(func.count()).select_from(Order).where(
            Order.client_id == client_id,
            Order.service_date == service_date,
            Order.status.not_in(terminal),
        )
        return int(await self.session.scalar(stmt) or 0)

    async def get_by_external_id(self, external_id: str) -> Order | None:
        result = await self.session.scalars(
            select(Order).where(Order.external_id == external_id)
        )
        return result.one_or_none()

    async def list_for_dispatch(
        self,
        service_date: date,
        *,
        exclude_planned_in_other_districts: str | None = None,
    ) -> builtins.list[Order]:
        statuses = (OrderStatus.created, OrderStatus.scheduled, OrderStatus.exception)
        stmt = select(Order).where(
            Order.service_date == service_date, Order.status.in_(statuses)
        )
        if exclude_planned_in_other_districts is not None:
            planned_in_other_district = (
                select(RouteAssignment.id)
                .join(RoutePlan, RoutePlan.id == RouteAssignment.plan_id)
                .where(
                    RoutePlan.service_date == service_date,
                    RoutePlan.district != exclude_planned_in_other_districts,
                    RoutePlan.status.in_((PlanStatus.draft, PlanStatus.published)),
                    Order.id == RouteAssignment.order_ids.any_(),
                )
                .exists()
            )
            stmt = stmt.where(~planned_in_other_district)
        result = await self.session.scalars(stmt.order_by(Order.desired_time, Order.id))
        return list(result)

    async def get_assigned_driver_id(self, order_id: uuid.UUID) -> uuid.UUID | None:
        stmt = (
            select(RouteAssignment.driver_id)
            .join(RoutePlan, RoutePlan.id == RouteAssignment.plan_id)
            .where(
                RoutePlan.status == PlanStatus.published,
                literal(order_id) == RouteAssignment.order_ids.any_(),
            )
            .order_by(RouteAssignment.seq)
            .limit(1)
        )
        driver_id: uuid.UUID | None = await self.session.scalar(stmt)
        return driver_id

    def add(self, order: Order) -> Order:
        self.session.add(order)
        return order


class DriversRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, driver_id: uuid.UUID) -> Driver | None:
        return await self.session.get(Driver, driver_id)

    async def list(
        self,
        *,
        region: str | None = None,
        is_online: bool | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> list[Driver]:
        stmt = (
            select(Driver)
            .join(User, User.id == Driver.user_id)
            .where(User.status == UserStatus.active)
            .order_by(Driver.full_name)
        )
        if region is not None:
            stmt = stmt.where(Driver.region == region)
        if is_online is not None:
            stmt = stmt.where(Driver.is_online == is_online)
        result = await self.session.scalars(stmt.limit(limit).offset(offset))
        return list(result)

    def add(self, driver: Driver) -> Driver:
        self.session.add(driver)
        return driver


class PlansRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, plan_id: uuid.UUID) -> RoutePlan | None:
        return await self.session.get(RoutePlan, plan_id)

    async def get_for_update(self, plan_id: uuid.UUID) -> RoutePlan | None:
        return (
            await self.session.scalars(
                select(RoutePlan).where(RoutePlan.id == plan_id).with_for_update()
            )
        ).one_or_none()

    async def list(
        self,
        *,
        service_date: date | None = None,
        status: PlanStatus | None = None,
        district: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[RoutePlan]:
        stmt = select(RoutePlan).order_by(RoutePlan.created_at.desc())
        if service_date is not None:
            stmt = stmt.where(RoutePlan.service_date == service_date)
        if status is not None:
            stmt = stmt.where(RoutePlan.status == status)
        if district is not None:
            stmt = stmt.where(RoutePlan.district == district)
        result = await self.session.scalars(stmt.limit(limit).offset(offset))
        return list(result)

    def add(self, plan: RoutePlan) -> RoutePlan:
        self.session.add(plan)
        return plan

    async def assignments(
        self, plan_id: uuid.UUID
    ) -> builtins.list[RouteAssignment]:
        result = await self.session.scalars(
            select(RouteAssignment)
            .where(RouteAssignment.plan_id == plan_id)
            .order_by(RouteAssignment.driver_id, RouteAssignment.seq)
        )
        return list(result)

    async def lunches(self, plan_id: uuid.UUID) -> builtins.list[DriverLunch]:
        result = await self.session.scalars(
            select(DriverLunch)
            .where(DriverLunch.plan_id == plan_id)
            .order_by(DriverLunch.driver_id)
        )
        return list(result)

    async def delete_assignments(self, plan_id: uuid.UUID) -> None:
        await self.session.execute(
            delete(RouteAssignment).where(RouteAssignment.plan_id == plan_id)
        )

    async def delete_lunches(self, plan_id: uuid.UUID) -> None:
        await self.session.execute(delete(DriverLunch).where(DriverLunch.plan_id == plan_id))

    async def published_for_date(
        self, service_date: date, district: str | None = None
    ) -> RoutePlan | None:
        stmt = (
            select(RoutePlan)
            .where(
                RoutePlan.service_date == service_date,
                RoutePlan.status == PlanStatus.published,
            )
            .order_by(RoutePlan.published_at.desc(), RoutePlan.created_at.desc())
            .limit(1)
        )
        if district is not None:
            stmt = stmt.where(RoutePlan.district == district)
        return (await self.session.scalars(stmt)).one_or_none()


class RoutingJobsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, job_id: uuid.UUID) -> RoutingJob | None:
        return await self.session.get(RoutingJob, job_id)

    async def get_for_update(self, job_id: uuid.UUID) -> RoutingJob | None:
        return (
            await self.session.scalars(
                select(RoutingJob).where(RoutingJob.id == job_id).with_for_update()
            )
        ).one_or_none()

    async def running(self, service_date: date, district: str) -> RoutingJob | None:
        return (
            await self.session.scalars(
                select(RoutingJob)
                .where(
                    RoutingJob.service_date == service_date,
                    RoutingJob.district == district,
                    RoutingJob.status == RoutingJobStatus.running,
                )
                .limit(1)
            )
        ).one_or_none()

    def add(self, job: RoutingJob) -> RoutingJob:
        self.session.add(job)
        return job
