import secrets
from typing import Annotated, Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import (
    get_auth_service,
    get_current_user,
    get_db,
    get_token_payload,
    require_roles,
)
from app.core.security import hash_password, normalize_phone
from app.domain.enums import UserRole, UserStatus
from app.domain.models import ClientProfile, Driver, DriverTrackHistory, Order, User
from app.domain.schemas import (
    ClientProfileOut,
    CreateUserRequest,
    CreateUserResponse,
    DevLoginRequest,
    DriverProfileOut,
    LoginRequest,
    LoginResponse,
    MePatch,
    MeResponse,
    RefreshRequest,
    TokenPair,
    UserOut,
)
from app.services.auth import AuthError, AuthService, RateLimitedError

router = APIRouter(prefix="/auth", tags=["auth"])
logger = structlog.get_logger(__name__)


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    request: Request,
    auth: Annotated[AuthService, Depends(get_auth_service)],
) -> LoginResponse:
    try:
        user, access, refresh = await auth.login(body.phone, body.password, _client_ip(request))
    except RateLimitedError as exc:
        raise HTTPException(
            status_code=429,
            detail="too many login attempts",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
    except AuthError as exc:
        raise HTTPException(status_code=401, detail="invalid credentials") from exc
    return LoginResponse(
        tokens=TokenPair(access_token=access, refresh_token=refresh),
        user=UserOut.model_validate(user),
    )


@router.post("/dev-login", response_model=LoginResponse, include_in_schema=False)
async def dev_login(
    body: DevLoginRequest,
    request: Request,
    auth: Annotated[AuthService, Depends(get_auth_service)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> LoginResponse:
    """Create a local UI account on first login; never available in production."""
    settings = request.app.state.settings
    if (
        settings.env != "dev"
        or not settings.dev_auto_register
        or not settings.dev_app_password
        or body.password != settings.dev_app_password
    ):
        raise HTTPException(status_code=404, detail="not found")

    try:
        phone = normalize_phone(body.phone)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    role = UserRole(body.role)
    user = await session.scalar(select(User).where(User.phone == phone))
    if user is None:
        default_name = {
            UserRole.client: f"Клиент {phone[-4:]}",
            UserRole.driver: f"Водитель {phone[-4:]}",
            UserRole.dispatcher: f"Диспетчер {phone[-4:]}",
        }[role]
        user = User(
            phone=phone,
            full_name=default_name,
            password_hash=hash_password(body.password),
            role=role,
        )
        session.add(user)
        await session.flush()
        if role == UserRole.client:
            session.add(
                ClientProfile(
                    user_id=user.id,
                    full_name=default_name,
                    needs_escort=False,
                )
            )
        elif role == UserRole.driver:
            session.add(
                Driver(
                    user_id=user.id,
                    full_name=default_name,
                    region="Атырау",
                    capacity=4,
                )
            )
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            user = await session.scalar(select(User).where(User.phone == phone))

    if user is None or user.role != role:
        raise HTTPException(status_code=409, detail="phone is registered with another role")

    try:
        logged_user, access, refresh_token = await auth.login(
            phone, body.password, _client_ip(request)
        )
    except RateLimitedError as exc:
        raise HTTPException(
            status_code=429,
            detail="too many login attempts",
            headers={"Retry-After": str(exc.retry_after)},
        ) from exc
    except AuthError as exc:
        raise HTTPException(status_code=401, detail="invalid credentials") from exc
    return LoginResponse(
        tokens=TokenPair(access_token=access, refresh_token=refresh_token),
        user=UserOut.model_validate(logged_user),
    )


@router.post("/refresh", response_model=TokenPair)
async def refresh(
    body: RefreshRequest,
    auth: Annotated[AuthService, Depends(get_auth_service)],
) -> TokenPair:
    try:
        _, access, new_refresh = await auth.refresh(body.refresh_token)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return TokenPair(access_token=access, refresh_token=new_refresh)


@router.post("/logout", status_code=204)
async def logout(
    payload: Annotated[dict[str, Any], Depends(get_token_payload)],
    auth: Annotated[AuthService, Depends(get_auth_service)],
) -> Response:
    await auth.logout(payload)
    return Response(status_code=204)


@router.get("/me", response_model=MeResponse)
async def me(
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> MeResponse:
    client_profile = driver_profile = None
    if user.role == UserRole.client:
        cp = await session.get(ClientProfile, user.id)
        client_profile = ClientProfileOut.model_validate(cp) if cp else None
    elif user.role == UserRole.driver:
        dp = await session.get(Driver, user.id)
        driver_profile = DriverProfileOut.model_validate(dp) if dp else None
    return MeResponse(
        user=UserOut.model_validate(user),
        client_profile=client_profile,
        driver_profile=driver_profile,
    )


@router.patch("/me", response_model=MeResponse)
async def update_me(
    body: MePatch,
    user: Annotated[User, Depends(get_current_user)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> MeResponse:
    """Update the current user's display name in the canonical profile."""
    full_name = body.full_name.strip() if body.full_name is not None else None
    region = body.region.strip() if body.region is not None else None
    if body.full_name is not None and not full_name:
        raise HTTPException(status_code=422, detail="full_name must not be blank")
    if body.region is not None and not region:
        raise HTTPException(status_code=422, detail="region must not be blank")
    if region is not None and user.role != UserRole.driver:
        raise HTTPException(status_code=422, detail="region is only available for drivers")

    if full_name is not None:
        user.full_name = full_name
    client_profile = driver_profile = None
    if user.role == UserRole.client:
        client = await session.get(ClientProfile, user.id)
        if client is None:
            raise HTTPException(status_code=409, detail="client profile is missing")
        if full_name is not None:
            client.full_name = full_name
        client_profile = ClientProfileOut.model_validate(client)
    elif user.role == UserRole.driver:
        driver = await session.get(Driver, user.id)
        if driver is None:
            raise HTTPException(status_code=409, detail="driver profile is missing")
        if full_name is not None:
            driver.full_name = full_name
        if region is not None:
            driver.region = region
        driver_profile = DriverProfileOut.model_validate(driver)

    await session.commit()
    return MeResponse(
        user=UserOut.model_validate(user),
        client_profile=client_profile,
        driver_profile=driver_profile,
    )


@router.delete("/me", status_code=204)
async def delete_my_account(
    user: Annotated[User, Depends(get_current_user)],
    auth: Annotated[AuthService, Depends(get_auth_service)],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    """Erase personal data while retaining anonymous operational records."""
    anonymous_name = "Удалённый пользователь"
    if user.role == UserRole.client:
        profile = await session.get(ClientProfile, user.id)
        if profile is not None:
            profile.full_name = anonymous_name
            profile.needs_escort = False
            profile.notes = None
            profile.default_addresses = []
        await session.execute(
            update(Order)
            .where(Order.client_id == user.id)
            .values(
                pickup_addr=None,
                pickup_lat=None,
                pickup_lon=None,
                dropoff_addr=None,
                dropoff_lat=None,
                dropoff_lon=None,
                cancel_reason=None,
                external_id=None,
            )
        )
    elif user.role == UserRole.driver:
        driver = await session.get(Driver, user.id)
        if driver is not None:
            driver.full_name = anonymous_name
            driver.region = "Удалено"
            driver.vehicle_model = None
            driver.plate = None
            driver.is_online = False
            driver.shift_start = None
            driver.shift_end = None
            driver.home_lat = None
            driver.home_lon = None
        await session.execute(
            delete(DriverTrackHistory).where(DriverTrackHistory.driver_id == user.id)
        )

    user.phone = f"deleted-{user.id}"
    user.password_hash = hash_password(secrets.token_urlsafe(32))
    user.status = UserStatus.blocked
    await session.commit()

    pipe = auth.redis.pipeline()
    pipe.srem("drivers:online", str(user.id))
    pipe.zrem("drivers:live", str(user.id))
    pipe.delete(f"driver:pos:{user.id}", f"driver:meta:{user.id}")
    await pipe.execute()
    await auth.revoke_all_sessions(user.id)
    logger.info("auth.account_deleted", user_id=str(user.id), role=user.role.value)
    return Response(status_code=204)


@router.post("/users", response_model=CreateUserResponse, status_code=201)
async def create_user(
    body: CreateUserRequest,
    actor: Annotated[User, Depends(require_roles(UserRole.admin, UserRole.dispatcher))],
    session: Annotated[AsyncSession, Depends(get_db)],
) -> CreateUserResponse:
    try:
        phone = normalize_phone(body.phone)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    existing = (
        await session.execute(select(User.id).where(User.phone == phone))
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="phone already registered")

    profile_name = None
    if body.client_profile is not None:
        profile_name = body.client_profile.full_name
    elif body.driver_profile is not None:
        profile_name = body.driver_profile.full_name
    user = User(
        phone=phone,
        full_name=profile_name,
        password_hash=hash_password(body.password),
        role=body.role,
    )
    session.add(user)
    await session.flush()

    if body.role == UserRole.client and body.client_profile is not None:
        session.add(ClientProfile(user_id=user.id, **body.client_profile.model_dump()))
    elif body.role == UserRole.driver and body.driver_profile is not None:
        session.add(Driver(user_id=user.id, **body.driver_profile.model_dump()))

    try:
        await session.commit()
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="phone already registered") from exc

    logger.info(
        "auth.user_created",
        user_id=str(user.id),
        role=body.role.value,
        actor_id=str(actor.id),
    )
    return CreateUserResponse(user=UserOut.model_validate(user))
