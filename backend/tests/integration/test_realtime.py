"""Realtime integration checks use Starlette's in-process WebSocket transport."""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, time, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from redis.asyncio import Redis
from starlette.websockets import WebSocketDisconnect

from app.core.config import Settings
from app.core.security import JWT_ALGORITHM, create_token_pair, hash_password
from app.domain.enums import AssignmentKind, OrderStatus, PlanStatus, UserRole
from app.domain.models import (
    ClientProfile,
    Driver,
    Order,
    RouteAssignment,
    RoutePlan,
    User,
)
from app.domain.schemas import DriverPositionOut
from app.main import create_app
from app.realtime.events import RoutePublishedPayload, event
from app.realtime.positions import publish_order_position


@pytest.fixture
def realtime_client(migrated_db: str, redis_url: str) -> Iterator[TestClient]:
    settings = Settings(
        _env_file=None,
        database_url=migrated_db,
        redis_url=redis_url,
        secret_key="realtime-test-secret",
    )
    with TestClient(create_app(settings)) as client:
        assert client.portal is not None
        client.portal.call(client.app.state.redis.flushdb)
        yield client


async def _user(client: TestClient, role: UserRole) -> tuple[uuid.UUID, str]:
    async with client.app.state.session_factory() as session:
        user = User(
            phone=f"79{uuid.uuid4().int % 100_000_000:08d}",
            password_hash=hash_password("realtime-password"),
            role=role,
        )
        session.add(user)
        await session.flush()
        if role == UserRole.client:
            session.add(ClientProfile(user_id=user.id, full_name="Realtime Client"))
        elif role == UserRole.driver:
            session.add(
                Driver(user_id=user.id, full_name="Realtime Driver", region="Center", capacity=4)
            )
        await session.commit()
    token, _, _, _ = create_token_pair(
        user_id=user.id, role=role.value, secret_key="realtime-test-secret"
    )
    return user.id, token


async def _published_plan_fixture(
    client: TestClient,
    client_id: uuid.UUID,
    driver_id: uuid.UUID,
    dispatcher_id: uuid.UUID,
) -> tuple[uuid.UUID, uuid.UUID]:
    async with client.app.state.session_factory() as session:
        order = Order(
            client_id=client_id,
            created_by=dispatcher_id,
            service_date=date.today(),
            desired_time=time(10),
            status=OrderStatus.scheduled,
        )
        plan = RoutePlan(
            service_date=date.today(),
            district="Center",
            status=PlanStatus.draft,
            needs_review=False,
            created_by=dispatcher_id,
        )
        session.add_all([order, plan])
        await session.flush()
        session.add(
            RouteAssignment(
                plan_id=plan.id,
                driver_id=driver_id,
                seq=0,
                kind=AssignmentKind.trip,
                order_ids=[order.id],
            )
        )
        await session.commit()
        return plan.id, order.id


def test_unauthorized_ws_closes_4401(realtime_client: TestClient) -> None:
    with (
        pytest.raises(WebSocketDisconnect) as missing,
        realtime_client.websocket_connect("/api/v1/ws"),
    ):
        pass
    assert missing.value.code == 4401

    expired = jwt.encode(
        {
            "sub": str(uuid.uuid4()),
            "role": UserRole.client.value,
            "jti": uuid.uuid4().hex,
            "type": "access",
            "exp": datetime.now(UTC) - timedelta(seconds=1),
        },
        "realtime-test-secret",
        algorithm=JWT_ALGORITHM,
    )
    with (
        pytest.raises(WebSocketDisconnect) as invalid,
        realtime_client.websocket_connect(f"/api/v1/ws?token={expired}"),
    ):
        pass
    assert invalid.value.code == 4401


def test_role_delivery_foreign_order_isolation_and_external_redis(
    realtime_client: TestClient,
) -> None:
    assert realtime_client.portal is not None
    driver_id, driver_token = realtime_client.portal.call(_user, realtime_client, UserRole.driver)
    client_id, client_token = realtime_client.portal.call(_user, realtime_client, UserRole.client)
    dispatcher_id, dispatcher_token = realtime_client.portal.call(
        _user, realtime_client, UserRole.dispatcher
    )
    plan_id, order_id = realtime_client.portal.call(
        _published_plan_fixture,
        realtime_client,
        client_id,
        driver_id,
        dispatcher_id,
    )
    foreign_id = uuid.uuid4()
    route = event(
        "route.published",
        RoutePublishedPayload(plan_id=uuid.uuid4(), service_date=date.today()),
    )
    with (
        realtime_client.websocket_connect(f"/api/v1/ws?token={driver_token}") as driver_ws,
        realtime_client.websocket_connect(f"/api/v1/ws?token={client_token}") as client_ws,
    ):
        response = realtime_client.post(
            f"/api/v1/plans/{plan_id}/publish",
            headers={"Authorization": f"Bearer {dispatcher_token}"},
        )
        assert response.status_code == 200, response.text
        assert driver_ws.receive_json()["type"] == "route.published"
        assert client_ws.receive_json()["type"] == "order.status_changed"
        channels = realtime_client.portal.call(
            lambda: set(realtime_client.app.state.realtime_hub._users[client_id][0].channels)
        )
        assert f"order:{order_id}" in channels
        assert f"order:{foreign_id}" not in channels

        async def external_publish() -> None:
            redis = Redis.from_url(
                realtime_client.app.state.settings.redis_url, decode_responses=True
            )
            try:
                await redis.publish(f"driver:{driver_id}", route.model_dump_json())
                await redis.publish(f"order:{foreign_id}", route.model_dump_json())
            finally:
                await redis.aclose()

        realtime_client.portal.call(external_publish)
        assert driver_ws.receive_json()["type"] == "route.published"


def test_fourth_connection_evicts_first(realtime_client: TestClient) -> None:
    assert realtime_client.portal is not None
    _, token = realtime_client.portal.call(_user, realtime_client, UserRole.client)
    first = realtime_client.websocket_connect(f"/api/v1/ws?token={token}")
    second = realtime_client.websocket_connect(f"/api/v1/ws?token={token}")
    third = realtime_client.websocket_connect(f"/api/v1/ws?token={token}")
    fourth = realtime_client.websocket_connect(f"/api/v1/ws?token={token}")
    with first as ws1, second, third, fourth:
        with pytest.raises(WebSocketDisconnect) as closed:
            ws1.receive_json()
        assert closed.value.code == 4408


def test_position_throttle(realtime_client: TestClient) -> None:
    assert realtime_client.portal is not None

    async def exercise() -> int:
        redis = realtime_client.app.state.redis
        order_id = uuid.uuid4()
        position = DriverPositionOut(
            driver_id=uuid.uuid4(),
            lat=47.1,
            lon=51.9,
            ts=datetime.now(UTC),
            accuracy_m=3.0,
        )
        async with redis.pubsub() as pubsub:
            await pubsub.subscribe(f"order:{order_id}")
            await pubsub.get_message(timeout=1)
            for _ in range(10):
                await publish_order_position(
                    redis, realtime_client.app.state.event_bus, order_id, position
                )
            count = 0
            while message := await pubsub.get_message(ignore_subscribe_messages=True, timeout=0.1):
                if message["type"] == "message":
                    count += 1
            return count

    assert realtime_client.portal.call(exercise) <= 2
