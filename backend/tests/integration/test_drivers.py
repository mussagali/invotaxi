import asyncio
import uuid
from datetime import UTC, date, datetime, time, timedelta
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from redis.asyncio import Redis
from sqlalchemy import event, select

from app.core.security import hash_password
from app.domain.enums import AssignmentKind, OrderStatus, PlanStatus, UserRole, UserStatus
from app.domain.models import (
    ClientProfile,
    Driver,
    DriverTrackHistory,
    Order,
    RouteAssignment,
    RoutePlan,
    User,
)
from app.domain.schemas import TelemetryPoint
from app.services.telemetry import POSITION_KEY, TelemetryService
from app.workers.main import flush_driver_positions, shutdown, startup

AppClient = tuple[FastAPI, httpx.AsyncClient]
PASSWORD = "drivers-test-password"


async def _create_user(app: FastAPI, phone: str, role: UserRole) -> uuid.UUID:
    async with app.state.session_factory() as session:
        user = User(phone=phone, password_hash=hash_password(PASSWORD), role=role)
        session.add(user)
        await session.flush()
        if role == UserRole.driver:
            session.add(
                Driver(
                    user_id=user.id,
                    full_name=f"Driver {phone}",
                    region="central",
                    capacity=4,
                    shift_start=time(7),
                    shift_end=time(19),
                )
            )
        elif role == UserRole.client:
            session.add(ClientProfile(user_id=user.id, full_name=f"Client {phone}"))
        await session.commit()
        return user.id


async def _headers(client: httpx.AsyncClient, phone: str) -> dict[str, str]:
    response = await client.post("/api/v1/auth/login", json={"phone": phone, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['tokens']['access_token']}"}


def _point(**overrides: object) -> dict[str, object]:
    point: dict[str, object] = {
        "lat": 47.1,
        "lon": 51.9,
        "ts": datetime.now(UTC).isoformat(),
        "accuracy_m": 3.0,
        "speed": 25.5,
        "heading": 90,
    }
    point.update(overrides)
    return point


async def test_location_is_sql_free_and_batch_uses_one_pipeline(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    await _create_user(app, "7104000001", UserRole.driver)
    headers = await _headers(client, "7104000001")
    statements: list[str] = []

    def count_sql(*args: object) -> None:
        statements.append(str(args[2]))

    event.listen(app.state.db_engine.sync_engine, "before_cursor_execute", count_sql)
    try:
        with patch.object(app.state.redis, "pipeline", wraps=app.state.redis.pipeline) as pipeline:
            response = await client.post(
                "/api/v1/drivers/me/location",
                json=[
                    _point(ts=(datetime.now(UTC) - timedelta(seconds=i)).isoformat())
                    for i in range(20)
                ],
                headers=headers,
            )
            assert pipeline.call_count == 1
    finally:
        event.remove(app.state.db_engine.sync_engine, "before_cursor_execute", count_sql)

    assert response.status_code == 200, response.text
    assert response.json() == {"accepted": 20, "rejected": 0}
    assert statements == []


async def test_anomaly_is_rejected_and_position_expires(app_with_client: AppClient) -> None:
    app, client = app_with_client
    driver_id = await _create_user(app, "7104000010", UserRole.driver)
    headers = await _headers(client, "7104000010")
    response = await client.post(
        "/api/v1/drivers/me/location",
        json=_point(lat=39.0, lon=50.0),
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json() == {"accepted": 0, "rejected": 1}
    anomaly_key = f"anomaly:{driver_id}:{date.today().isoformat()}"
    assert await app.state.redis.get(anomaly_key) == "1"
    assert not await app.state.redis.exists(POSITION_KEY.format(driver_id=driver_id))

    await app.state.redis.delete(f"telemetry:rate:{driver_id}")
    inaccurate = await client.post(
        "/api/v1/drivers/me/location",
        json=_point(accuracy_m=5.01),
        headers=headers,
    )
    assert inaccurate.status_code == 200
    assert inaccurate.json() == {"accepted": 0, "rejected": 1}
    assert await app.state.redis.get(anomaly_key) == "2"

    await app.state.redis.delete(f"telemetry:rate:{driver_id}")
    accepted = await client.post(
        "/api/v1/drivers/me/location",
        json=_point(lat=51.1694, lon=71.4491),
        headers=headers,
    )
    assert accepted.status_code == 200
    position_key = POSITION_KEY.format(driver_id=driver_id)
    assert 0 < await app.state.redis.ttl(position_key) <= 120
    await app.state.redis.expire(position_key, 1)
    await asyncio.sleep(1.1)
    assert not await app.state.redis.exists(position_key)


async def test_flush_moves_online_position_to_track_history(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    driver_id = await _create_user(app, "7104000020", UserRole.driver)
    headers = await _headers(client, "7104000020")
    online = await client.post("/api/v1/drivers/me/online", headers=headers)
    assert online.status_code == 200
    ingested = await client.post("/api/v1/drivers/me/location", json=_point(), headers=headers)
    assert ingested.status_code == 200

    count = await flush_driver_positions(
        {
            "redis": app.state.redis,
            "telemetry_redis": app.state.redis,
            "session_factory": app.state.session_factory,
        }
    )
    assert count == 1
    async with app.state.session_factory() as session:
        rows = list(
            await session.scalars(
                select(DriverTrackHistory).where(DriverTrackHistory.driver_id == driver_id)
            )
        )
        assert len(rows) == 1
        assert rows[0].lat == 47.1
        assert rows[0].lon == 51.9
        assert rows[0].accuracy_m == 3.0


async def test_flush_uses_decoded_redis_with_arq_bytes_pool(
    app_with_client: AppClient,
    redis_url: str,
) -> None:
    app, client = app_with_client
    driver_id = await _create_user(app, "7104000021", UserRole.driver)
    headers = await _headers(client, "7104000021")
    online = await client.post("/api/v1/drivers/me/online", headers=headers)
    assert online.status_code == 200

    service = TelemetryService(app.state.redis)
    await service.ingest(driver_id, [TelemetryPoint(**_point())])

    bytes_client = Redis.from_url(redis_url)
    ctx = {"redis": bytes_client, "session_factory": app.state.session_factory}
    try:
        raw_position = await bytes_client.hgetall(POSITION_KEY.format(driver_id=driver_id))
        assert b"lat" in raw_position
        with patch("app.workers.main.get_settings", return_value=app.state.settings):
            await startup(ctx)
        count = await flush_driver_positions(ctx)
        assert count == 1
        async with app.state.session_factory() as session:
            rows = list(
                await session.scalars(
                    select(DriverTrackHistory).where(
                        DriverTrackHistory.driver_id == driver_id
                    )
                )
            )
            assert len(rows) == 1
            assert rows[0].lat == 47.1
            assert rows[0].lon == 51.9
    finally:
        await shutdown(ctx)
        await bytes_client.aclose()


async def test_driver_position_hides_foreign_order(app_with_client: AppClient) -> None:
    app, client = app_with_client
    owner_id = await _create_user(app, "7104000030", UserRole.client)
    await _create_user(app, "7104000031", UserRole.client)
    driver_id = await _create_user(app, "7104000032", UserRole.driver)
    owner_headers = await _headers(client, "7104000030")
    foreign_headers = await _headers(client, "7104000031")

    async with app.state.session_factory() as session:
        order = Order(
            client_id=owner_id,
            created_by=owner_id,
            service_date=date.today(),
            desired_time=time(10),
            status=OrderStatus.assigned,
            seats=1,
        )
        plan = RoutePlan(
            service_date=date.today(),
            district="central",
            status=PlanStatus.published,
            created_by=owner_id,
        )
        session.add_all([order, plan])
        await session.flush()
        session.add(
            RouteAssignment(
                plan_id=plan.id,
                driver_id=driver_id,
                seq=1,
                kind=AssignmentKind.trip,
                order_ids=[order.id],
            )
        )
        await session.commit()
        order_id = order.id

    await app.state.redis.hset(
        POSITION_KEY.format(driver_id=driver_id),
        mapping={**_point(), "ts": datetime.now(UTC).isoformat()},
    )
    await app.state.redis.expire(POSITION_KEY.format(driver_id=driver_id), 120)

    hidden = await client.get(f"/api/v1/orders/{order_id}/driver-position", headers=foreign_headers)
    assert hidden.status_code == 404
    visible = await client.get(f"/api/v1/orders/{order_id}/driver-position", headers=owner_headers)
    assert visible.status_code == 200, visible.text
    assert visible.json()["driver_id"] == str(driver_id)


async def test_admin_sees_driver_phone_and_can_archive_driver(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    driver_id = await _create_user(app, "7104000090", UserRole.driver)
    await _create_user(app, "7104000091", UserRole.admin)
    headers = await _headers(client, "7104000091")

    listed = await client.get("/api/v1/drivers", headers=headers)
    assert listed.status_code == 200, listed.text
    driver = next(row for row in listed.json() if row["user_id"] == str(driver_id))
    assert driver["phone"] == "7104000090"

    archived = await client.delete(f"/api/v1/drivers/{driver_id}", headers=headers)
    assert archived.status_code == 204, archived.text
    listed_after = await client.get("/api/v1/drivers", headers=headers)
    assert all(row["user_id"] != str(driver_id) for row in listed_after.json())
    async with app.state.session_factory() as session:
        user = await session.get(User, driver_id)
        assert user is not None and user.status == UserStatus.blocked
