"""Dispatcher-facing client directory backed by real user/profile records."""

import secrets
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, require_roles
from app.core.security import hash_password, normalize_phone
from app.domain.enums import UserRole, UserStatus
from app.domain.models import ClientProfile, Order, User
from app.domain.schemas import ClientAdminOut, ClientAdminPatch, ClientStatsOut

router = APIRouter(prefix="/clients", tags=["clients"])
Dispatcher = Annotated[User, Depends(require_roles(UserRole.dispatcher, UserRole.admin))]


def _out(user: User, profile: ClientProfile, orders_count: int) -> ClientAdminOut:
    return ClientAdminOut(
        user_id=user.id,
        phone=user.phone,
        status=user.status,
        full_name=profile.full_name,
        needs_escort=profile.needs_escort,
        notes=profile.notes,
        default_addresses=profile.default_addresses or [],
        orders_count=orders_count,
    )


@router.get("", response_model=list[ClientAdminOut])
async def list_clients(
    actor: Dispatcher,
    session: Annotated[AsyncSession, Depends(get_db)],
    search: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[ClientAdminOut]:
    del actor
    order_counts = (
        select(Order.client_id, func.count(Order.id).label("orders_count"))
        .group_by(Order.client_id)
        .subquery()
    )
    query = (
        select(User, ClientProfile, func.coalesce(order_counts.c.orders_count, 0))
        .join(ClientProfile, ClientProfile.user_id == User.id)
        .outerjoin(order_counts, order_counts.c.client_id == User.id)
        .where(User.role == UserRole.client, User.status == UserStatus.active)
        .order_by(ClientProfile.full_name, User.id)
        .limit(limit)
        .offset(offset)
    )
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.where(
            or_(ClientProfile.full_name.ilike(pattern), User.phone.ilike(pattern))
        )
    rows = (await session.execute(query)).all()
    return [_out(user, profile, int(count)) for user, profile, count in rows]


@router.get("/stats", response_model=ClientStatsOut)
async def client_stats(
    actor: Dispatcher,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> ClientStatsOut:
    del actor
    total, with_companion = (
        await session.execute(
            select(
                func.count(ClientProfile.user_id),
                func.count(ClientProfile.user_id).filter(ClientProfile.needs_escort.is_(True)),
            )
            .join(User, User.id == ClientProfile.user_id)
            .where(User.status == UserStatus.active)
        )
    ).one()
    total_orders = await session.scalar(select(func.count(Order.id)))
    return ClientStatsOut(
        total=int(total or 0),
        with_companion=int(with_companion or 0),
        total_orders=int(total_orders or 0),
    )


@router.get("/{client_id}", response_model=ClientAdminOut)
async def get_client(
    client_id: uuid.UUID,
    actor: Dispatcher,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> ClientAdminOut:
    del actor
    row = (
        await session.execute(
            select(User, ClientProfile, func.count(Order.id))
            .join(ClientProfile, ClientProfile.user_id == User.id)
            .outerjoin(Order, Order.client_id == User.id)
            .where(
                User.id == client_id,
                User.role == UserRole.client,
                User.status == UserStatus.active,
            )
            .group_by(User.id, ClientProfile.user_id)
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="client not found")
    return _out(row[0], row[1], int(row[2]))


@router.patch("/{client_id}", response_model=ClientAdminOut)
async def patch_client(
    client_id: uuid.UUID,
    body: ClientAdminPatch,
    actor: Dispatcher,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> ClientAdminOut:
    del actor
    user = await session.get(User, client_id)
    profile = await session.get(ClientProfile, client_id)
    if user is None or profile is None or user.role != UserRole.client:
        raise HTTPException(status_code=404, detail="client not found")
    values = body.model_dump(exclude_unset=True)
    phone = values.pop("phone", None)
    if phone is not None:
        try:
            user.phone = normalize_phone(phone)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    for field, value in values.items():
        setattr(profile, field, value)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=409, detail="phone already registered") from exc
    await session.refresh(profile)
    count = await session.scalar(select(func.count(Order.id)).where(Order.client_id == client_id))
    return _out(user, profile, int(count or 0))


@router.delete("/{client_id}", status_code=204)
async def archive_client(
    client_id: uuid.UUID,
    actor: Dispatcher,
    session: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    """Remove a client from the directory while retaining anonymous order history."""
    del actor
    user = await session.get(User, client_id)
    profile = await session.get(ClientProfile, client_id)
    if user is None or profile is None or user.role != UserRole.client:
        raise HTTPException(status_code=404, detail="client not found")
    user.phone = f"deleted-{client_id}"
    user.full_name = "Удалённый пользователь"
    user.password_hash = hash_password(secrets.token_urlsafe(32))
    user.status = UserStatus.blocked
    profile.full_name = "Удалённый пользователь"
    profile.needs_escort = False
    profile.notes = None
    profile.default_addresses = []
    await session.commit()
    return Response(status_code=204)
