"""Thin HTTP adapter for orders."""

import uuid
from datetime import date
from typing import Annotated, Any, NoReturn

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db, get_redis, require_roles
from app.domain.enums import OrderStatus, UserRole
from app.domain.models import Order, User
from app.domain.schemas import (
    AssignedDriverOut,
    CancelOrderRequest,
    DriverPositionOut,
    ImportReport,
    OrderCreate,
    OrderOut,
    OrderPatch,
    TransitionOrderRequest,
    TwinOrderRequest,
)
from app.services.order_state import OrderStateError, transition_order
from app.services.orders import OrderServiceError, OrdersService

router = APIRouter(prefix="/orders", tags=["orders"])


def _raise_service_error(exc: OrderServiceError | OrderStateError) -> NoReturn:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


async def _orders_out(service: OrdersService, orders: list[Order]) -> list[OrderOut]:
    assigned = await service.repo.assigned_driver_rows([order.id for order in orders])
    result: list[OrderOut] = []
    for order in orders:
        value = OrderOut.model_validate(order)
        row = assigned.get(order.id)
        if row is not None:
            driver, phone = row
            value.assigned_driver = AssignedDriverOut(
                id=driver.user_id,
                name=driver.full_name,
                car_model=driver.vehicle_model,
                plate_number=driver.plate,
                phone=phone,
            )
        result.append(value)
    return result


@router.post("/import", response_model=ImportReport)
async def import_orders(
    rows: Annotated[list[dict[str, Any]], Body()],
    actor: Annotated[User, Depends(require_roles(UserRole.dispatcher, UserRole.admin))],
    session: Annotated[AsyncSession, Depends(get_db)],
    service_date: Annotated[date | None, Query()] = None,
) -> ImportReport:
    try:
        return await OrdersService(session).import_legacy(
            rows, actor, service_date=service_date or date.today()
        )
    except OrderServiceError as exc:
        _raise_service_error(exc)


@router.post("", response_model=OrderOut, status_code=201)
async def create_order(
    body: OrderCreate,
    actor: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> OrderOut:
    try:
        order = await OrdersService(session).create(body, actor)
    except OrderServiceError as exc:
        _raise_service_error(exc)
    return OrderOut.model_validate(order)


@router.get("", response_model=list[OrderOut])
async def list_orders(
    actor: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_db)],
    service_date: date | None = None,
    service_date_from: date | None = None,
    service_date_to: date | None = None,
    status: OrderStatus | None = None,
    district: str | None = None,
    client_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[OrderOut]:
    if service_date_from and service_date_to and service_date_from > service_date_to:
        raise HTTPException(
            status_code=422,
            detail="service_date_from must not exceed service_date_to",
        )
    orders = await OrdersService(session).list_visible(
        actor,
        service_date=service_date,
        service_date_from=service_date_from,
        service_date_to=service_date_to,
        status=status,
        district=district,
        client_id=client_id,
        limit=limit,
        offset=offset,
    )
    return await _orders_out(OrdersService(session), orders)


@router.get("/{order_id}", response_model=OrderOut)
async def get_order(
    order_id: uuid.UUID,
    actor: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> OrderOut:
    try:
        order = await OrdersService(session).get_visible(order_id, actor)
    except OrderServiceError as exc:
        _raise_service_error(exc)
    return (await _orders_out(OrdersService(session), [order]))[0]


@router.get(
    "/{order_id}/driver-position",
    response_model=DriverPositionOut,
    responses={204: {"description": "Driver position is unavailable or expired"}},
)
async def get_order_driver_position(
    order_id: uuid.UUID,
    actor: Annotated[User, Depends(require_roles(UserRole.client))],
    session: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> DriverPositionOut | Response:
    try:
        position = await OrdersService(session).assigned_driver_position(order_id, actor, redis)
    except OrderServiceError as exc:
        _raise_service_error(exc)
    if position is None:
        return Response(status_code=204)
    return position


@router.patch("/{order_id}", response_model=OrderOut)
async def patch_order(
    order_id: uuid.UUID,
    body: OrderPatch,
    actor: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> OrderOut:
    try:
        order = await OrdersService(session).patch(order_id, body, actor)
    except OrderServiceError as exc:
        _raise_service_error(exc)
    return OrderOut.model_validate(order)


@router.post("/{order_id}/cancel", response_model=OrderOut)
async def cancel_order(
    order_id: uuid.UUID,
    body: CancelOrderRequest,
    actor: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> OrderOut:
    service = OrdersService(session)
    try:
        await service.get_visible(order_id, actor)
        if actor.role == UserRole.driver:
            raise OrderServiceError("insufficient role", 403)
        order = await transition_order(
            session,
            order_id,
            OrderStatus.cancelled,
            actor=actor,
            meta={"reason": body.reason},
        )
        await session.commit()
        await session.refresh(order)
    except (OrderServiceError, OrderStateError) as exc:
        _raise_service_error(exc)
    return OrderOut.model_validate(order)


@router.post("/{order_id}/transition", response_model=OrderOut)
async def transition(
    order_id: uuid.UUID,
    body: TransitionOrderRequest,
    actor: Annotated[User, Depends(require_roles(UserRole.dispatcher, UserRole.admin))],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> OrderOut:
    try:
        order = await transition_order(
            session, order_id, body.to, actor=actor, meta=body.meta
        )
        await session.commit()
        await session.refresh(order)
    except OrderStateError as exc:
        _raise_service_error(exc)
    return OrderOut.model_validate(order)


@router.post("/{order_id}/driver-transition", response_model=OrderOut)
async def driver_transition(
    order_id: uuid.UUID,
    body: TransitionOrderRequest,
    actor: Annotated[User, Depends(require_roles(UserRole.driver))],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> OrderOut:
    if body.to not in {
        OrderStatus.driver_en_route,
        OrderStatus.picked_up,
        OrderStatus.completed,
    }:
        raise HTTPException(status_code=403, detail="driver cannot set this status")
    try:
        await OrdersService(session).get_visible(order_id, actor)
        order = await transition_order(session, order_id, body.to, actor=actor, meta=body.meta)
        await session.commit()
        await session.refresh(order)
    except (OrderServiceError, OrderStateError) as exc:
        _raise_service_error(exc)
    return OrderOut.model_validate(order)


@router.post("/{order_id}/twin", response_model=OrderOut)
async def link_twin(
    order_id: uuid.UUID,
    body: TwinOrderRequest,
    actor: Annotated[User, Depends(require_roles(UserRole.dispatcher, UserRole.admin))],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> OrderOut:
    try:
        order = await OrdersService(session).link_twins(
            order_id, body.other_order_id, actor
        )
    except OrderServiceError as exc:
        _raise_service_error(exc)
    return OrderOut.model_validate(order)
