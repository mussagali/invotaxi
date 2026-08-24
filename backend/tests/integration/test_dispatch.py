import json
import uuid
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from sqlalchemy import select

from app.core.security import hash_password
from app.domain.enums import (
    AssignmentKind,
    OrderStatus,
    PlanStatus,
    RoutingJobStatus,
    UserRole,
)
from app.domain.models import (
    ClientProfile,
    Driver,
    DriverLunch,
    Order,
    OrderEvent,
    RouteAssignment,
    RoutePlan,
    RoutingJob,
    User,
)
from app.services.dispatch import run_dispatch_job

AppClient = tuple[FastAPI, httpx.AsyncClient]
PASSWORD = "dispatch-test-password"


async def _create_user(
    app: FastAPI,
    phone: str,
    role: UserRole,
    *,
    district: str = "central",
    online: bool = False,
    capacity: int = 4,
) -> uuid.UUID:
    async with app.state.session_factory() as session:
        user = User(phone=phone, password_hash=hash_password(PASSWORD), role=role)
        session.add(user)
        await session.flush()
        if role == UserRole.client:
            session.add(ClientProfile(user_id=user.id, full_name=f"Client {phone}"))
        elif role == UserRole.driver:
            session.add(
                Driver(
                    user_id=user.id,
                    full_name=f"Driver {phone}",
                    region=district,
                    capacity=capacity,
                    is_online=online,
                    shift_start=time(7),
                    shift_end=time(20),
                    home_lat=47.10,
                    home_lon=51.90,
                )
            )
        await session.commit()
        return user.id


async def _headers(client: httpx.AsyncClient, phone: str) -> dict[str, str]:
    response = await client.post("/api/v1/auth/login", json={"phone": phone, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['tokens']['access_token']}"}


async def _create_order(
    app: FastAPI,
    client_id: uuid.UUID,
    service_date: date,
    desired_time: time,
    *,
    pickup: tuple[float, float] = (47.10, 51.90),
    dropoff: tuple[float, float] = (47.11, 51.91),
    status: OrderStatus = OrderStatus.created,
    twin_group_id: uuid.UUID | None = None,
) -> uuid.UUID:
    async with app.state.session_factory() as session:
        order = Order(
            client_id=client_id,
            created_by=client_id,
            service_date=service_date,
            desired_time=desired_time,
            pickup_addr="Pickup",
            pickup_lat=pickup[0],
            pickup_lon=pickup[1],
            dropoff_addr="Dropoff",
            dropoff_lat=dropoff[0],
            dropoff_lon=dropoff[1],
            escort=False,
            seats=1,
            status=status,
            twin_group_id=twin_group_id,
        )
        session.add(order)
        await session.commit()
        await session.refresh(order)
        return order.id


async def _create_job(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    service_date: date,
    district: str,
    *,
    config_overrides: dict[str, Any] | None = None,
) -> uuid.UUID:
    response = await client.post(
        "/api/v1/dispatch/jobs",
        json={
            "service_date": service_date.isoformat(),
            "district": district,
            "config_overrides": config_overrides or {},
        },
        headers=headers,
    )
    assert response.status_code == 202, response.text
    return uuid.UUID(response.json()["job_id"])


async def _run_job(app: FastAPI, job_id: uuid.UUID) -> bool:
    return await run_dispatch_job(
        {"redis": app.state.redis, "session_factory": app.state.session_factory},
        str(job_id),
    )


async def _plan_for_job(app: FastAPI, job_id: uuid.UUID) -> RoutePlan:
    async with app.state.session_factory() as session:
        plan: RoutePlan = (
            await session.scalars(select(RoutePlan).where(RoutePlan.routing_job_id == job_id))
        ).one()
        return plan


def _assignment(
    plan_id: uuid.UUID,
    driver_id: uuid.UUID,
    order_id: uuid.UUID,
    desired_minute: int,
) -> RouteAssignment:
    pickup_at = datetime.combine(date.today(), time.min, tzinfo=UTC) + timedelta(
        minutes=desired_minute - 15
    )
    dropoff_at = pickup_at + timedelta(minutes=27)
    return RouteAssignment(
        plan_id=plan_id,
        driver_id=driver_id,
        seq=1,
        kind=AssignmentKind.trip,
        order_ids=[order_id],
        planned_pickup_at=pickup_at,
        planned_dropoff_at=dropoff_at,
        pickup_seq=[
            {
                "order_id": str(order_id),
                "lat": 47.10,
                "lon": 51.90,
                "time": float(desired_minute - 15),
            }
        ],
        dropoff_seq=[
            {
                "order_id": str(order_id),
                "lat": 47.11,
                "lon": 51.91,
                "time": float(desired_minute + 12),
            }
        ],
    )


async def _pubsub_messages(pubsub: Any, count: int) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    for _ in range(20):
        message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=0.1)
        if message is not None:
            messages.append({**message, "data": json.loads(message["data"])})
            if len(messages) == count:
                break
    return messages


def _assert_no_planned_fields(value: Any) -> None:
    if isinstance(value, dict):
        assert not any(str(key).startswith("planned_") for key in value)
        for child in value.values():
            _assert_no_planned_fields(child)
    elif isinstance(value, list):
        for child in value:
            _assert_no_planned_fields(child)


async def test_full_dispatch_cycle_move_publish_and_redis_events(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    service_date = date.today() + timedelta(days=30)
    district = "p6-cycle"
    await _create_user(app, "7106000001", UserRole.dispatcher)
    client_id = await _create_user(app, "7106000002", UserRole.client)
    driver_ids = {
        await _create_user(app, "7106000003", UserRole.driver, district=district, online=True),
        await _create_user(app, "7106000004", UserRole.driver, district=district, online=True),
    }
    first_order_id = await _create_order(app, client_id, service_date, time(9))
    second_order_id = await _create_order(app, client_id, service_date, time(11))
    order_ids = {first_order_id, second_order_id}
    desired_times = {
        str(first_order_id): "09:00:00",
        str(second_order_id): "11:00:00",
    }
    headers = await _headers(client, "7106000001")

    job_id = await _create_job(client, headers, service_date, district)
    assert await _run_job(app, job_id) is True
    plan = await _plan_for_job(app, job_id)
    assert plan.status == PlanStatus.draft
    async with app.state.session_factory() as session:
        draft_statuses = set(
            await session.scalars(select(Order.status).where(Order.id.in_(order_ids)))
        )
    assert draft_statuses == {OrderStatus.scheduled}

    draft_response = await client.get(f"/api/v1/plans/{plan.id}", headers=headers)
    assert draft_response.status_code == 200, draft_response.text
    draft = draft_response.json()
    assert draft["status"] == "draft"
    assert {
        order_id
        for driver in draft["drivers"]
        for block in driver["blocks"]
        for order_id in block["order_ids"]
    } == {str(item) for item in order_ids}

    moving_order = uuid.UUID(draft["drivers"][0]["blocks"][0]["order_ids"][0])
    source_driver = uuid.UUID(draft["drivers"][0]["driver_id"])
    target_driver = next(item for item in driver_ids if item != source_driver)
    moved_response = await client.post(
        f"/api/v1/plans/{plan.id}/move",
        json={"order_id": str(moving_order), "to_driver_id": str(target_driver)},
        headers=headers,
    )
    assert moved_response.status_code == 200, moved_response.text
    moved = moved_response.json()
    assert any(
        driver["driver_id"] == str(target_driver)
        and any(str(moving_order) in block["order_ids"] for block in driver["blocks"])
        for driver in moved["drivers"]
    )

    expected_orders_by_driver = {
        driver["driver_id"]: {
            order_id: desired_times[order_id]
            for block in driver["blocks"]
            for order_id in block["order_ids"]
        }
        for driver in moved["drivers"]
        if driver["blocks"]
    }
    publish_driver_ids = set(expected_orders_by_driver)
    pubsub = app.state.redis.pubsub()
    channels = [*(f"driver:{item}" for item in publish_driver_ids), f"dispatch:{district}"]
    await pubsub.subscribe(*channels)
    try:
        published_response = await client.post(f"/api/v1/plans/{plan.id}/publish", headers=headers)
        assert published_response.status_code == 200, published_response.text
        assert published_response.json()["status"] == "published"
        messages = await _pubsub_messages(pubsub, len(channels))
    finally:
        await pubsub.unsubscribe(*channels)
        await pubsub.aclose()

    assert {message["channel"] for message in messages} == set(channels)
    dispatch_message = next(
        message for message in messages if message["channel"] == f"dispatch:{district}"
    )
    dispatch_event = dispatch_message["data"]
    assert set(dispatch_event) == {"v", "type", "ts", "payload"}
    assert dispatch_event["v"] == 1
    assert dispatch_event["type"] == "plan.published"
    assert datetime.fromisoformat(dispatch_event["ts"])
    assert dispatch_event["payload"] == {
        "plan_id": str(plan.id),
        "service_date": service_date.isoformat(),
        "district": district,
    }
    driver_messages = [message for message in messages if message["channel"].startswith("driver:")]
    assert len(driver_messages) == len(publish_driver_ids)
    for message in driver_messages:
        driver_id = message["channel"].removeprefix("driver:")
        driver_event = message["data"]
        assert set(driver_event) == {"v", "type", "ts", "payload"}
        assert driver_event["v"] == 1
        assert driver_event["type"] == "route.published"
        assert datetime.fromisoformat(driver_event["ts"])
        payload = driver_event["payload"]
        assert set(payload) == {"plan_id", "service_date", "orders"}
        assert payload["plan_id"] == str(plan.id)
        assert payload["service_date"] == service_date.isoformat()
        assert len(payload["orders"]) == len(expected_orders_by_driver[driver_id])
        assert {
            order["order_id"]: order["desired_time"] for order in payload["orders"]
        } == expected_orders_by_driver[driver_id]
        assert all(set(order) == {"order_id", "desired_time"} for order in payload["orders"])
        _assert_no_planned_fields(payload["orders"])
    async with app.state.session_factory() as session:
        statuses = set(await session.scalars(select(Order.status).where(Order.id.in_(order_ids))))
    assert statuses == {OrderStatus.assigned}


async def test_second_job_for_running_scope_returns_409(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    service_date = date.today() + timedelta(days=31)
    district = "p6-running"
    await _create_user(app, "7106000010", UserRole.dispatcher)
    headers = await _headers(client, "7106000010")
    first_job_id = await _create_job(client, headers, service_date, district)
    async with app.state.session_factory() as session:
        job = await session.get(RoutingJob, first_job_id)
        assert job is not None
        job.status = RoutingJobStatus.running
        await session.commit()

    repeated = await client.post(
        "/api/v1/dispatch/jobs",
        json={"service_date": service_date.isoformat(), "district": district},
        headers=headers,
    )
    assert repeated.status_code == 409


async def test_needs_review_plan_requires_force_and_records_actor(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    actor_id = await _create_user(app, "7106000020", UserRole.dispatcher)
    headers = await _headers(client, "7106000020")
    async with app.state.session_factory() as session:
        plan = RoutePlan(
            service_date=date.today() + timedelta(days=32),
            district="p6-force",
            status=PlanStatus.draft,
            needs_review=True,
            stats={},
            created_by=actor_id,
        )
        session.add(plan)
        await session.commit()
        await session.refresh(plan)
        plan_id = plan.id

    rejected = await client.post(f"/api/v1/plans/{plan_id}/publish", headers=headers)
    assert 400 <= rejected.status_code < 500
    forced = await client.post(
        f"/api/v1/plans/{plan_id}/publish", params={"force": "true"}, headers=headers
    )
    assert forced.status_code == 200, forced.text
    assert forced.json()["status"] == "published"
    assert forced.json()["stats"]["force_published_by"] == str(actor_id)


async def test_invalid_move_is_422_and_does_not_mutate_plan(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    service_date = date.today() + timedelta(days=33)
    district = "p6-move-invalid"
    actor_id = await _create_user(app, "7106000030", UserRole.dispatcher)
    client_id = await _create_user(app, "7106000031", UserRole.client)
    source_driver = await _create_user(
        app, "7106000032", UserRole.driver, district=district, online=True
    )
    target_driver = await _create_user(
        app, "7106000033", UserRole.driver, district=district, online=True
    )
    moving_order = await _create_order(
        app,
        client_id,
        service_date,
        time(9),
        pickup=(47.30, 52.10),
        dropoff=(47.31, 52.11),
        status=OrderStatus.scheduled,
    )
    target_order = await _create_order(
        app,
        client_id,
        service_date,
        time(9),
        pickup=(46.90, 51.60),
        dropoff=(46.91, 51.61),
        status=OrderStatus.scheduled,
    )
    async with app.state.session_factory() as session:
        plan = RoutePlan(
            service_date=service_date,
            district=district,
            status=PlanStatus.draft,
            stats={"config_overrides": {"pool_max_km": 0.0}},
            created_by=actor_id,
        )
        session.add(plan)
        await session.flush()
        session.add_all(
            [
                _assignment(plan.id, source_driver, moving_order, 540),
                _assignment(plan.id, target_driver, target_order, 540),
            ]
        )
        await session.commit()
        plan_id = plan.id
    headers = await _headers(client, "7106000030")
    before = (await client.get(f"/api/v1/plans/{plan_id}", headers=headers)).json()

    response = await client.post(
        f"/api/v1/plans/{plan_id}/move",
        json={"order_id": str(moving_order), "to_driver_id": str(target_driver)},
        headers=headers,
    )
    assert response.status_code == 422, response.text
    after = (await client.get(f"/api/v1/plans/{plan_id}", headers=headers)).json()
    assert after == before


async def test_failed_job_keeps_orders_and_does_not_create_plan(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    service_date = date.today() + timedelta(days=34)
    district = "p6-failed"
    await _create_user(app, "7106000040", UserRole.dispatcher)
    client_id = await _create_user(app, "7106000041", UserRole.client)
    await _create_user(app, "7106000042", UserRole.driver, district=district, online=True)
    created_order = await _create_order(app, client_id, service_date, time(9))
    scheduled_order = await _create_order(
        app, client_id, service_date, time(11), status=OrderStatus.scheduled
    )
    headers = await _headers(client, "7106000040")
    job_id = await _create_job(client, headers, service_date, district)

    with patch("app.services.dispatch.solve", side_effect=RuntimeError("solver exploded")):
        assert await _run_job(app, job_id) is False

    async with app.state.session_factory() as session:
        job = await session.get(RoutingJob, job_id)
        assert job is not None
        assert job.status == RoutingJobStatus.failed
        assert "solver exploded" in (job.error or "")
        statuses = {
            row.id: row.status
            for row in await session.scalars(
                select(Order).where(Order.id.in_([created_order, scheduled_order]))
            )
        }
        plans = list(
            await session.scalars(select(RoutePlan).where(RoutePlan.routing_job_id == job_id))
        )
    assert statuses == {
        created_order: OrderStatus.created,
        scheduled_order: OrderStatus.scheduled,
    }
    assert plans == []


async def test_twins_stay_in_one_block_on_one_driver(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    service_date = date.today() + timedelta(days=35)
    district = "p6-twins"
    await _create_user(app, "7106000050", UserRole.dispatcher)
    client_id = await _create_user(app, "7106000051", UserRole.client)
    await _create_user(app, "7106000052", UserRole.driver, district=district, online=True)
    await _create_user(app, "7106000053", UserRole.driver, district=district, online=True)
    twin_group_id = uuid.uuid4()
    twin_ids = {
        await _create_order(
            app,
            client_id,
            service_date,
            time(10),
            twin_group_id=twin_group_id,
        ),
        await _create_order(
            app,
            client_id,
            service_date,
            time(10),
            twin_group_id=twin_group_id,
        ),
    }
    headers = await _headers(client, "7106000050")
    job_id = await _create_job(client, headers, service_date, district)
    assert await _run_job(app, job_id) is True
    plan = await _plan_for_job(app, job_id)
    plan_response = await client.get(f"/api/v1/plans/{plan.id}", headers=headers)
    assert plan_response.status_code == 200, plan_response.text

    containing = [
        (driver["driver_id"], block["order_ids"])
        for driver in plan_response.json()["drivers"]
        for block in driver["blocks"]
        if twin_ids.intersection(uuid.UUID(item) for item in block["order_ids"])
    ]
    assert len(containing) == 1
    assert {uuid.UUID(item) for item in containing[0][1]} == twin_ids


async def test_insert_success_failure_and_lunch_is_respected(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    service_date = date.today() + timedelta(days=36)
    district = "p6-insert"
    actor_id = await _create_user(app, "7106000060", UserRole.dispatcher)
    client_id = await _create_user(app, "7106000061", UserRole.client)
    driver_id = await _create_user(
        app, "7106000062", UserRole.driver, district=district, online=True
    )
    existing_order = await _create_order(
        app, client_id, service_date, time(9), status=OrderStatus.assigned
    )
    successful_order = await _create_order(app, client_id, service_date, time(14))
    failed_order = await _create_order(
        app,
        client_id,
        service_date,
        time(9),
        pickup=(47.30, 52.10),
        dropoff=(47.31, 52.11),
    )
    async with app.state.session_factory() as session:
        plan = RoutePlan(
            service_date=service_date,
            district=district,
            status=PlanStatus.published,
            stats={"config_overrides": {}},
            created_by=actor_id,
            published_at=datetime.now(UTC),
        )
        session.add(plan)
        await session.flush()
        assignment = _assignment(plan.id, driver_id, existing_order, 540)
        assignment.planned_pickup_at = datetime.combine(service_date, time(8, 45), tzinfo=UTC)
        assignment.planned_dropoff_at = datetime.combine(service_date, time(9, 12), tzinfo=UTC)
        session.add_all(
            [
                assignment,
                DriverLunch(
                    plan_id=plan.id,
                    driver_id=driver_id,
                    start_min=630,
                    end_min=750,
                    is_full=True,
                ),
            ]
        )
        await session.commit()
        plan_id = plan.id
    headers = await _headers(client, "7106000060")

    placed = await client.post(
        "/api/v1/dispatch/insert",
        json={"order_id": str(successful_order)},
        headers=headers,
    )
    assert placed.status_code == 200, placed.text
    assert placed.json()["placed"] is True
    assert placed.json()["driver_id"] == str(driver_id)
    plan_response = await client.get(f"/api/v1/plans/{plan_id}", headers=headers)
    assert plan_response.status_code == 200, plan_response.text
    route = next(
        item for item in plan_response.json()["drivers"] if item["driver_id"] == str(driver_id)
    )
    assert any(str(successful_order) in block["order_ids"] for block in route["blocks"])
    lunch = route["lunch"]
    assert lunch is not None
    for block in route["blocks"]:
        start = datetime.fromisoformat(block["planned_pickup_at"])
        end = datetime.fromisoformat(block["planned_dropoff_at"])
        start_min = start.hour * 60 + start.minute
        end_min = end.hour * 60 + end.minute
        assert end_min <= lunch["start_min"] or start_min >= lunch["end_min"]

    not_placed = await client.post(
        "/api/v1/dispatch/insert",
        json={"order_id": str(failed_order)},
        headers=headers,
    )
    assert not_placed.status_code == 200, not_placed.text
    assert not_placed.json()["placed"] is False
    async with app.state.session_factory() as session:
        successful = await session.get(Order, successful_order)
        failed = await session.get(Order, failed_order)
        assert successful is not None and successful.status == OrderStatus.assigned
        assert failed is not None and failed.status == OrderStatus.exception


async def test_client_and_driver_order_responses_hide_planned_times(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    service_date = date.today() + timedelta(days=37)
    district = "p6-public-time"
    client_id = await _create_user(app, "7106000070", UserRole.client)
    driver_id = await _create_user(
        app, "7106000071", UserRole.driver, district=district, online=True
    )
    order_id = await _create_order(
        app, client_id, service_date, time(10, 20), status=OrderStatus.assigned
    )
    async with app.state.session_factory() as session:
        plan = RoutePlan(
            service_date=service_date,
            district=district,
            status=PlanStatus.published,
            published_at=datetime.now(UTC),
            created_by=client_id,
        )
        session.add(plan)
        await session.flush()
        assignment = _assignment(plan.id, driver_id, order_id, 620)
        assignment.planned_pickup_at = datetime.combine(service_date, time(10, 5), tzinfo=UTC)
        assignment.planned_dropoff_at = datetime.combine(service_date, time(10, 47), tzinfo=UTC)
        session.add(assignment)
        await session.commit()
    client_headers = await _headers(client, "7106000070")
    driver_headers = await _headers(client, "7106000071")

    for headers in (client_headers, driver_headers):
        response = await client.get(f"/api/v1/orders/{order_id}", headers=headers)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["desired_time"] == "10:20:00"
        _assert_no_planned_fields(body)


async def test_dispatcher_can_assign_manually_and_driver_sees_order(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    service_date = date.today() + timedelta(days=40)
    district = "manual-assignment"
    await _create_user(app, "7106000090", UserRole.dispatcher)
    client_id = await _create_user(app, "7106000091", UserRole.client)
    driver_id = await _create_user(
        app, "7106000092", UserRole.driver, district=district, online=False
    )
    order_id = await _create_order(app, client_id, service_date, time(10, 20))
    dispatcher_headers = await _headers(client, "7106000090")
    driver_headers = await _headers(client, "7106000092")

    candidates = await client.get(
        f"/api/v1/dispatch/candidates/{order_id}", headers=dispatcher_headers
    )
    assert candidates.status_code == 200, candidates.text
    assert str(driver_id) in {row["driver_id"] for row in candidates.json()["candidates"]}

    assigned = await client.post(
        f"/api/v1/dispatch/assign/{order_id}",
        json={"driver_id": str(driver_id)},
        headers=dispatcher_headers,
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["order"]["status"] == "assigned"
    assert assigned.json()["order"]["assigned_driver"]["id"] == str(driver_id)

    visible = await client.get("/api/v1/orders", headers=driver_headers)
    assert visible.status_code == 200, visible.text
    assert [row["id"] for row in visible.json()] == [str(order_id)]

    admin_list = await client.get("/api/v1/orders", headers=dispatcher_headers)
    row = next(item for item in admin_list.json() if item["id"] == str(order_id))
    assert row["assigned_driver"]["id"] == str(driver_id)


async def test_automatic_assignment_chooses_online_driver(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    service_date = date.today() + timedelta(days=41)
    await _create_user(app, "7106000093", UserRole.dispatcher)
    client_id = await _create_user(app, "7106000094", UserRole.client)
    driver_id = await _create_user(
        app, "7106000095", UserRole.driver, district="auto-assignment", online=True
    )
    order_id = await _create_order(app, client_id, service_date, time(11, 20))
    headers = await _headers(client, "7106000093")

    assigned = await client.post(
        f"/api/v1/dispatch/assign/{order_id}", json={}, headers=headers
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["driver_id"] == str(driver_id)
    assert assigned.json()["auto_assigned"] is True


async def test_job_excludes_orders_planned_in_another_district(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    service_date = date.today() + timedelta(days=38)
    district_a = "p6-cross-district-a"
    district_b = "p6-cross-district-b"
    await _create_user(app, "7106000080", UserRole.dispatcher)
    client_id = await _create_user(app, "7106000081", UserRole.client)
    await _create_user(
        app, "7106000082", UserRole.driver, district=district_a, online=True
    )
    await _create_user(
        app, "7106000083", UserRole.driver, district=district_b, online=True
    )
    order_x = await _create_order(app, client_id, service_date, time(9))
    headers = await _headers(client, "7106000080")

    job_a = await _create_job(client, headers, service_date, district_a)
    assert await _run_job(app, job_a) is True
    plan_a = await _plan_for_job(app, job_a)
    async with app.state.session_factory() as session:
        assignments_a = await session.scalars(
            select(RouteAssignment).where(RouteAssignment.plan_id == plan_a.id)
        )
        assert any(order_x in row.order_ids for row in assignments_a)

    order_y = await _create_order(app, client_id, service_date, time(11))
    job_b = await _create_job(client, headers, service_date, district_b)
    assert await _run_job(app, job_b) is True
    plan_b = await _plan_for_job(app, job_b)

    async with app.state.session_factory() as session:
        assignments_b = list(
            await session.scalars(
                select(RouteAssignment).where(RouteAssignment.plan_id == plan_b.id)
            )
        )
        order = await session.get(Order, order_x)
        exception_events = list(
            await session.scalars(
                select(OrderEvent).where(
                    OrderEvent.order_id == order_x,
                    OrderEvent.to_status == OrderStatus.exception,
                )
            )
        )

    assert any(order_y in row.order_ids for row in assignments_b)
    assert all(order_x not in row.order_ids for row in assignments_b)
    assert order is not None and order.status == OrderStatus.scheduled
    assert exception_events == []
