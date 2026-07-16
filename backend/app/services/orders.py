"""Orders business rules, authorization and legacy import."""

import uuid
from datetime import date, time
from typing import Any

from pydantic import ValidationError
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, normalize_phone
from app.domain.enums import OrderStatus, UserRole
from app.domain.models import ClientProfile, Order, User
from app.domain.repositories import OrdersRepository
from app.domain.schemas import (
    DriverPositionOut,
    ImportErrorOut,
    ImportReport,
    LegacyOrderImportRow,
    OrderCreate,
    OrderPatch,
)
from app.services.telemetry import get_driver_position

MAX_ACTIVE_ORDERS_PER_DATE = 4
EDITABLE_STATUSES = (OrderStatus.created, OrderStatus.scheduled)


class OrderServiceError(Exception):
    def __init__(self, message: str, status_code: int) -> None:
        self.status_code = status_code
        super().__init__(message)


class OrdersService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repo = OrdersRepository(session)

    async def _lock_client(self, client_id: uuid.UUID) -> ClientProfile:
        profile = await self.session.scalar(
            select(ClientProfile)
            .where(ClientProfile.user_id == client_id)
            .with_for_update()
        )
        if profile is None:
            raise OrderServiceError("client not found", 422)
        return profile

    async def _ensure_capacity(self, client_id: uuid.UUID, service_date: date) -> None:
        await self._lock_client(client_id)
        if await self.repo.count_active(client_id, service_date) >= MAX_ACTIVE_ORDERS_PER_DATE:
            raise OrderServiceError("client already has 4 active orders for this date", 409)

    async def create(self, body: OrderCreate, actor: User) -> Order:
        if body.service_date < date.today():
            raise OrderServiceError("service_date must be today or later", 422)
        if actor.role == UserRole.client:
            client_id = actor.id
        elif actor.role in (UserRole.dispatcher, UserRole.admin):
            if body.client_id is None:
                raise OrderServiceError("client_id is required for dispatcher", 422)
            client_id = body.client_id
        else:
            raise OrderServiceError("insufficient role", 403)

        await self._ensure_capacity(client_id, body.service_date)
        values = body.model_dump(exclude={"client_id"})
        order = Order(
            client_id=client_id,
            created_by=actor.id,
            seats=2 if body.escort else 1,
            **values,
        )
        self.repo.add(order)
        await self.session.commit()
        await self.session.refresh(order)
        return order

    async def get_visible(self, order_id: uuid.UUID, actor: User) -> Order:
        order = await self.repo.get(order_id)
        if order is None:
            raise OrderServiceError("order not found", 404)
        visible = actor.role in (UserRole.dispatcher, UserRole.admin)
        if actor.role == UserRole.client:
            visible = order.client_id == actor.id
        elif actor.role == UserRole.driver:
            visible = await self.repo.driver_can_access(order.id, actor.id)
        if not visible:
            raise OrderServiceError("order not found", 404)
        return order

    async def assigned_driver_position(
        self, order_id: uuid.UUID, actor: User, redis: Redis
    ) -> DriverPositionOut | None:
        order = await self.get_visible(order_id, actor)
        visible_statuses = (
            OrderStatus.assigned,
            OrderStatus.driver_en_route,
            OrderStatus.picked_up,
        )
        if actor.role != UserRole.client or order.status not in visible_statuses:
            raise OrderServiceError("driver position is not available", 409)
        driver_id = await self.repo.get_assigned_driver_id(order.id)
        if driver_id is None:
            return None
        return await get_driver_position(redis, driver_id)

    async def list_visible(
        self,
        actor: User,
        *,
        service_date: date | None,
        service_date_from: date | None,
        service_date_to: date | None,
        status: OrderStatus | None,
        district: str | None,
        client_id: uuid.UUID | None,
        limit: int,
        offset: int,
    ) -> list[Order]:
        driver_id = None
        if actor.role == UserRole.client:
            client_id = actor.id
        elif actor.role == UserRole.driver:
            driver_id = actor.id
        return await self.repo.list(
            service_date=service_date,
            service_date_from=service_date_from,
            service_date_to=service_date_to,
            status=status,
            district=district,
            client_id=client_id,
            driver_id=driver_id,
            limit=limit,
            offset=offset,
        )

    async def patch(self, order_id: uuid.UUID, body: OrderPatch, actor: User) -> Order:
        order = await self.get_visible(order_id, actor)
        if actor.role == UserRole.driver:
            raise OrderServiceError("order not found", 404)
        locked_order = await self.repo.get_for_update(order.id)
        assert locked_order is not None
        if locked_order.status not in EDITABLE_STATUSES:
            raise OrderServiceError("order can only be edited while created or scheduled", 409)

        values = body.model_dump(exclude_unset=True)
        for field, value in values.items():
            setattr(locked_order, field, value)
        if "escort" in values:
            locked_order.seats = 2 if locked_order.escort else 1
        await self.session.commit()
        await self.session.refresh(locked_order)
        return locked_order

    async def link_twins(
        self, order_id: uuid.UUID, other_order_id: uuid.UUID, actor: User
    ) -> Order:
        if order_id == other_order_id:
            raise OrderServiceError("an order cannot be its own twin", 422)
        first_id, second_id = sorted((order_id, other_order_id), key=str)
        first = await self.repo.get_for_update(first_id)
        second = await self.repo.get_for_update(second_id)
        if first is None or second is None:
            raise OrderServiceError("order not found", 404)
        if first.service_date != second.service_date or first.desired_time != second.desired_time:
            raise OrderServiceError("twins must have the same service_date and desired_time", 422)
        if first.status not in EDITABLE_STATUSES or second.status not in EDITABLE_STATUSES:
            raise OrderServiceError("twins must be created or scheduled", 409)
        if (
            first.twin_group_id is not None
            and second.twin_group_id is not None
            and first.twin_group_id != second.twin_group_id
        ):
            raise OrderServiceError("orders already belong to different twin groups", 409)

        group_id = first.twin_group_id or second.twin_group_id or uuid.uuid4()
        first.twin_group_id = group_id
        second.twin_group_id = group_id
        await self.session.commit()
        selected = first if first.id == order_id else second
        await self.session.refresh(selected)
        return selected

    @staticmethod
    def _parse_escort(note: str | None) -> bool:
        normalized = (note or "").casefold().strip()
        if "без сопровождения" in normalized:
            return False
        return "с сопровождением" in normalized

    async def import_legacy(
        self,
        rows: list[dict[str, Any]],
        actor: User,
        service_date: date,
    ) -> ImportReport:
        if service_date < date.today():
            raise OrderServiceError("service_date must be today or later", 422)
        created = skipped = 0
        errors: list[ImportErrorOut] = []

        for index, raw in enumerate(rows):
            external_id = raw.get("external_id")
            try:
                row = LegacyOrderImportRow.model_validate(raw)
            except ValidationError as exc:
                errors.append(
                    ImportErrorOut(
                        index=index,
                        external_id=str(external_id) if external_id is not None else None,
                        message=str(exc),
                    )
                )
                continue

            if await self.repo.get_by_external_id(row.external_id) is not None:
                skipped += 1
                continue

            try:
                async with self.session.begin_nested():
                    phone = normalize_phone(row.phone)
                    user = await self.session.scalar(select(User).where(User.phone == phone))
                    if user is None:
                        user = User(
                            phone=phone,
                            password_hash=hash_password(uuid.uuid4().hex),
                            role=UserRole.client,
                        )
                        self.session.add(user)
                        await self.session.flush()
                        self.session.add(
                            ClientProfile(
                                user_id=user.id,
                                full_name=row.fio,
                                needs_escort=self._parse_escort(row.escort_note),
                                notes=row.escort_note,
                            )
                        )
                        await self.session.flush()
                    elif user.role != UserRole.client:
                        raise OrderServiceError("phone belongs to a non-client user", 409)

                    await self._ensure_capacity(user.id, service_date)
                    escort = self._parse_escort(row.escort_note)
                    self.repo.add(
                        Order(
                            client_id=user.id,
                            created_by=actor.id,
                            service_date=service_date,
                            desired_time=time.fromisoformat(row.time),
                            pickup_addr=row.from_addr,
                            pickup_lat=row.pickup_lat,
                            pickup_lon=row.pickup_lon,
                            dropoff_addr=row.to_addr,
                            dropoff_lat=row.dropoff_lat,
                            dropoff_lon=row.dropoff_lon,
                            escort=escort,
                            seats=2 if escort else 1,
                            external_id=row.external_id,
                        )
                    )
                    await self.session.flush()
                created += 1
            except (IntegrityError, OrderServiceError, ValueError) as exc:
                errors.append(
                    ImportErrorOut(
                        index=index,
                        external_id=row.external_id,
                        message=str(exc),
                    )
                )

        await self.session.commit()
        return ImportReport(created=created, skipped=skipped, errors=errors)
