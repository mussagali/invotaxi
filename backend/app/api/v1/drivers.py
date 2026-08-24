"""Driver profile and live telemetry endpoints."""

import uuid
from typing import Annotated, Any, NoReturn

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_db, get_redis, get_token_payload, require_roles
from app.core.security import normalize_phone
from app.domain.enums import UserRole, UserStatus
from app.domain.models import Driver, User
from app.domain.schemas import (
    DriverMeOut,
    DriverOut,
    DriverPatch,
    DriverPositionOut,
    TelemetryIngestOut,
    TelemetryPoint,
)
from app.services.drivers import DriverServiceError, DriversService
from app.services.telemetry import TelemetryRateLimitError, TelemetryService

router = APIRouter(prefix="/drivers", tags=["drivers"])


def _raise_service_error(exc: DriverServiceError) -> NoReturn:
    raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc


@router.get("/me", response_model=DriverMeOut)
async def get_me(
    actor: Annotated[User, Depends(require_roles(UserRole.driver))],
    session: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> DriverMeOut:
    try:
        return await DriversService(session, redis).get_me(actor.id)
    except DriverServiceError as exc:
        _raise_service_error(exc)


async def _set_online(
    actor: User, session: AsyncSession, redis: Redis, is_online: bool
) -> DriverOut:
    try:
        driver = await DriversService(session, redis).set_online(actor.id, is_online)
    except DriverServiceError as exc:
        _raise_service_error(exc)
    return DriverOut.model_validate(driver)


@router.post("/me/online", response_model=DriverOut)
async def go_online(
    actor: Annotated[User, Depends(require_roles(UserRole.driver))],
    session: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> DriverOut:
    return await _set_online(actor, session, redis, True)


@router.post("/me/offline", response_model=DriverOut)
async def go_offline(
    actor: Annotated[User, Depends(require_roles(UserRole.driver))],
    session: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> DriverOut:
    return await _set_online(actor, session, redis, False)


@router.post("/me/location", response_model=TelemetryIngestOut)
async def ingest_location(
    body: Annotated[TelemetryPoint | list[TelemetryPoint], Body()],
    payload: Annotated[dict[str, Any], Depends(get_token_payload)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> TelemetryIngestOut:
    if payload.get("role") != UserRole.driver.value:
        raise HTTPException(status_code=403, detail="insufficient role")
    points = body if isinstance(body, list) else [body]
    if not 1 <= len(points) <= 20:
        raise HTTPException(status_code=422, detail="telemetry batch must contain 1..20 points")
    try:
        return await TelemetryService(redis).ingest(uuid.UUID(payload["sub"]), points)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=401, detail="invalid token subject") from exc
    except TelemetryRateLimitError as exc:
        raise HTTPException(
            status_code=429,
            detail="telemetry rate limit exceeded",
            headers={"Retry-After": "1"},
        ) from exc


@router.get("/live", response_model=list[DriverPositionOut])
async def live_positions(
    actor: Annotated[User, Depends(require_roles(UserRole.dispatcher, UserRole.admin))],
    session: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
    district: str | None = None,
) -> list[DriverPositionOut]:
    drivers = await DriversService(session, redis).list(
        region=district,
        is_online=True,
        limit=1000,
        offset=0,
    )
    return await TelemetryService(redis).live_positions({driver.user_id for driver in drivers})


@router.get("", response_model=list[DriverOut])
async def list_drivers(
    actor: Annotated[User, Depends(require_roles(UserRole.dispatcher, UserRole.admin))],
    session: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
    region: str | None = None,
    is_online: bool | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[DriverOut]:
    drivers = await DriversService(session, redis).list(
        region=region,
        is_online=is_online,
        limit=limit,
        offset=offset,
    )
    phones = {
        user.id: user.phone
        for user in await session.scalars(
            select(User).where(User.id.in_({driver.user_id for driver in drivers}))
        )
    }
    return [
        DriverOut.model_validate(driver).model_copy(
            update={"phone": phones.get(driver.user_id)}
        )
        for driver in drivers
    ]


@router.patch("/{driver_id}", response_model=DriverOut)
async def patch_driver(
    driver_id: uuid.UUID,
    body: DriverPatch,
    actor: Annotated[User, Depends(require_roles(UserRole.dispatcher, UserRole.admin))],
    session: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> DriverOut:
    if body.phone is not None:
        user = await session.get(User, driver_id)
        if user is None or user.role != UserRole.driver:
            raise HTTPException(status_code=404, detail="driver not found")
        try:
            user.phone = normalize_phone(body.phone)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        driver = await DriversService(session, redis).patch(driver_id, body)
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=409, detail="phone already registered") from exc
    except DriverServiceError as exc:
        _raise_service_error(exc)
    user = await session.get(User, driver.user_id)
    return DriverOut.model_validate(driver).model_copy(
        update={"phone": user.phone if user else None}
    )


@router.delete("/{driver_id}", status_code=204)
async def archive_driver(
    driver_id: uuid.UUID,
    actor: Annotated[User, Depends(require_roles(UserRole.admin))],
    session: Annotated[AsyncSession, Depends(get_db)],
    redis: Annotated[Redis, Depends(get_redis)],
) -> Response:
    """Archive a driver account while preserving completed route history."""
    driver = await session.get(Driver, driver_id)
    user = await session.get(User, driver_id)
    if driver is None or user is None or user.role != UserRole.driver:
        raise HTTPException(status_code=404, detail="driver not found")
    driver.is_online = False
    user.status = UserStatus.blocked
    await session.commit()
    pipe = redis.pipeline()
    pipe.srem("drivers:online", str(driver_id))
    pipe.zrem("drivers:live", str(driver_id))
    pipe.delete(f"driver:pos:{driver_id}", f"driver:meta:{driver_id}")
    await pipe.execute()
    return Response(status_code=204)
