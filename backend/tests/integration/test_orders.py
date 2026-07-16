import uuid
from datetime import date, timedelta

import httpx
from fastapi import FastAPI
from sqlalchemy import func, select

from app.core.security import hash_password
from app.domain.enums import AssignmentKind, PlanStatus, UserRole
from app.domain.models import (
    ClientProfile,
    Driver,
    OrderEvent,
    RouteAssignment,
    RoutePlan,
    User,
)

AppClient = tuple[FastAPI, httpx.AsyncClient]
PASSWORD = "orders-test-password"


async def _create_user(app: FastAPI, phone: str, role: UserRole) -> uuid.UUID:
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
                    region="central",
                    capacity=4,
                )
            )
        await session.commit()
        return user.id


async def _headers(client: httpx.AsyncClient, phone: str) -> dict[str, str]:
    response = await client.post(
        "/api/v1/auth/login", json={"phone": phone, "password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    token = response.json()["tokens"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _order_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "service_date": str(date.today() + timedelta(days=2)),
        "desired_time": "09:30",
        "pickup_addr": "A",
        "dropoff_addr": "B",
        "pickup_lat": 47.10,
        "pickup_lon": 51.90,
        "dropoff_lat": 47.11,
        "dropoff_lon": 51.91,
        "escort": False,
    }
    payload.update(overrides)
    return payload


async def _create_order(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    **overrides: object,
) -> dict[str, object]:
    response = await client.post(
        "/api/v1/orders", json=_order_payload(**overrides), headers=headers
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_create_and_list_orders_with_limits(app_with_client: AppClient) -> None:
    app, client = app_with_client
    client_id = await _create_user(app, "7103000001", UserRole.client)
    other_id = await _create_user(app, "7103000002", UserRole.client)
    headers = await _headers(client, "7103000001")

    created = await _create_order(
        client,
        headers,
        client_id=str(other_id),
        escort=True,
        seats=99,
    )
    assert created["client_id"] == str(client_id)
    assert created["seats"] == 2
    assert created["status"] == "created"

    listed = await client.get(
        "/api/v1/orders",
        params={"client_id": str(other_id), "status": "created", "limit": 1},
        headers=headers,
    )
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()] == [created["id"]]

    past = await client.post(
        "/api/v1/orders",
        json=_order_payload(service_date=str(date.today() - timedelta(days=1))),
        headers=headers,
    )
    assert past.status_code == 422
    for desired_time in ("10:00", "11:00", "12:00"):
        await _create_order(client, headers, desired_time=desired_time)
    over_limit = await client.post(
        "/api/v1/orders", json=_order_payload(desired_time="13:00"), headers=headers
    )
    assert over_limit.status_code == 409
    too_many = await client.get("/api/v1/orders", params={"limit": 101}, headers=headers)
    assert too_many.status_code == 422


async def test_create_order_accepts_coordinates_outside_atyrau(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    await _create_user(app, "7103000098", UserRole.client)
    headers = await _headers(client, "7103000098")

    order = await _create_order(
        client,
        headers,
        pickup_addr="Астана, проспект Республики",
        dropoff_addr="Астана, улица Кунаева",
        pickup_lat=51.1694,
        pickup_lon=71.4491,
        dropoff_lat=51.1282,
        dropoff_lon=71.4304,
    )
    assert order["pickup_lat"] == 51.1694
    assert order["dropoff_lon"] == 71.4304


async def test_get_hides_foreign_order_and_checks_published_driver_plan(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    owner_id = await _create_user(app, "7103000010", UserRole.client)
    await _create_user(app, "7103000011", UserRole.client)
    driver_id = await _create_user(app, "7103000012", UserRole.driver)
    owner_headers = await _headers(client, "7103000010")
    foreign_headers = await _headers(client, "7103000011")
    driver_headers = await _headers(client, "7103000012")
    order = await _create_order(client, owner_headers)

    assert (
        await client.get(f"/api/v1/orders/{order['id']}", headers=owner_headers)
    ).status_code == 200
    hidden = await client.get(f"/api/v1/orders/{order['id']}", headers=foreign_headers)
    assert hidden.status_code == 404

    assert (
        await client.get(f"/api/v1/orders/{order['id']}", headers=driver_headers)
    ).status_code == 404
    async with app.state.session_factory() as session:
        plan = RoutePlan(
            service_date=date.today() + timedelta(days=2),
            district="central",
            status=PlanStatus.published,
            created_by=owner_id,
        )
        session.add(plan)
        await session.flush()
        session.add(
            RouteAssignment(
                plan_id=plan.id,
                driver_id=driver_id,
                seq=1,
                kind=AssignmentKind.trip,
                order_ids=[uuid.UUID(str(order["id"]))],
            )
        )
        await session.commit()
    assert (
        await client.get(f"/api/v1/orders/{order['id']}", headers=driver_headers)
    ).status_code == 200


async def test_assigned_driver_can_advance_only_the_ride_lifecycle(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    owner_id = await _create_user(app, "7103000013", UserRole.client)
    driver_id = await _create_user(app, "7103000014", UserRole.driver)
    await _create_user(app, "7103000015", UserRole.dispatcher)
    owner_headers = await _headers(client, "7103000013")
    driver_headers = await _headers(client, "7103000014")
    dispatcher_headers = await _headers(client, "7103000015")
    order = await _create_order(client, owner_headers)

    for status in ("scheduled", "assigned"):
        response = await client.post(
            f"/api/v1/orders/{order['id']}/transition",
            json={"to": status, "meta": {}},
            headers=dispatcher_headers,
        )
        assert response.status_code == 200, response.text

    async with app.state.session_factory() as session:
        plan = RoutePlan(
            service_date=date.today() + timedelta(days=2),
            district="central",
            status=PlanStatus.published,
            created_by=owner_id,
        )
        session.add(plan)
        await session.flush()
        session.add(
            RouteAssignment(
                plan_id=plan.id,
                driver_id=driver_id,
                seq=1,
                kind=AssignmentKind.trip,
                order_ids=[uuid.UUID(str(order["id"]))],
            )
        )
        await session.commit()

    forbidden = await client.post(
        f"/api/v1/orders/{order['id']}/driver-transition",
        json={"to": "cancelled", "meta": {}},
        headers=driver_headers,
    )
    assert forbidden.status_code == 403

    for status in ("driver_en_route", "picked_up", "completed"):
        response = await client.post(
            f"/api/v1/orders/{order['id']}/driver-transition",
            json={"to": status, "meta": {}},
            headers=driver_headers,
        )
        assert response.status_code == 200, response.text
        assert response.json()["status"] == status


async def test_patch_updates_seats_and_hides_foreign_order(app_with_client: AppClient) -> None:
    app, client = app_with_client
    await _create_user(app, "7103000020", UserRole.client)
    await _create_user(app, "7103000021", UserRole.client)
    owner_headers = await _headers(client, "7103000020")
    foreign_headers = await _headers(client, "7103000021")
    order = await _create_order(client, owner_headers)

    changed = await client.patch(
        f"/api/v1/orders/{order['id']}",
        json={"desired_time": "10:15", "escort": True},
        headers=owner_headers,
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["desired_time"] == "10:15:00"
    assert changed.json()["seats"] == 2

    hidden = await client.patch(
        f"/api/v1/orders/{order['id']}", json={"escort": False}, headers=foreign_headers
    )
    assert hidden.status_code == 404
    bad_bbox = await client.patch(
        f"/api/v1/orders/{order['id']}", json={"pickup_lat": 0}, headers=owner_headers
    )
    assert bad_bbox.status_code == 422
    assert "outside Kazakhstan" in bad_bbox.json()["error"]["message"]


async def test_cancel_writes_event_and_requires_reason(app_with_client: AppClient) -> None:
    app, client = app_with_client
    await _create_user(app, "7103000030", UserRole.client)
    headers = await _headers(client, "7103000030")
    order = await _create_order(client, headers)

    missing = await client.post(
        f"/api/v1/orders/{order['id']}/cancel", json={"reason": ""}, headers=headers
    )
    assert missing.status_code == 422
    cancelled = await client.post(
        f"/api/v1/orders/{order['id']}/cancel",
        json={"reason": "client request"},
        headers=headers,
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["cancel_reason"] == "client request"

    async with app.state.session_factory() as session:
        event = (
            await session.scalars(
                select(OrderEvent).where(OrderEvent.order_id == uuid.UUID(str(order["id"])))
            )
        ).one()
        assert event.from_status.value == "created"
        assert event.to_status.value == "cancelled"
        assert event.meta["cancelled_by"] == "client"


async def test_transition_chain_events_and_completed_cancel_conflict(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    await _create_user(app, "7103000040", UserRole.client)
    await _create_user(app, "7103000041", UserRole.dispatcher)
    client_headers = await _headers(client, "7103000040")
    dispatcher_headers = await _headers(client, "7103000041")
    order = await _create_order(client, client_headers)

    forbidden = await client.post(
        f"/api/v1/orders/{order['id']}/transition",
        json={"to": "scheduled", "meta": {}},
        headers=client_headers,
    )
    assert forbidden.status_code == 403

    statuses = ["scheduled", "assigned", "driver_en_route", "picked_up", "completed"]
    for status in statuses:
        response = await client.post(
            f"/api/v1/orders/{order['id']}/transition",
            json={"to": status, "meta": {"source": "test"}},
            headers=dispatcher_headers,
        )
        assert response.status_code == 200, response.text
        assert response.json()["status"] == status

    conflict = await client.post(
        f"/api/v1/orders/{order['id']}/cancel",
        json={"reason": "too late"},
        headers=client_headers,
    )
    assert conflict.status_code == 409
    async with app.state.session_factory() as session:
        count = await session.scalar(
            select(func.count())
            .select_from(OrderEvent)
            .where(OrderEvent.order_id == uuid.UUID(str(order["id"])))
        )
        assert count == len(statuses)


async def test_twin_success_and_different_time_422(app_with_client: AppClient) -> None:
    app, client = app_with_client
    await _create_user(app, "7103000050", UserRole.client)
    await _create_user(app, "7103000051", UserRole.dispatcher)
    client_headers = await _headers(client, "7103000050")
    dispatcher_headers = await _headers(client, "7103000051")
    first = await _create_order(client, client_headers, desired_time="11:00")
    second = await _create_order(client, client_headers, desired_time="11:00")
    different = await _create_order(client, client_headers, desired_time="11:30")

    linked = await client.post(
        f"/api/v1/orders/{first['id']}/twin",
        json={"other_order_id": second["id"]},
        headers=dispatcher_headers,
    )
    assert linked.status_code == 200, linked.text
    group_id = linked.json()["twin_group_id"]
    second_get = await client.get(
        f"/api/v1/orders/{second['id']}", headers=dispatcher_headers
    )
    assert second_get.json()["twin_group_id"] == group_id

    mismatch = await client.post(
        f"/api/v1/orders/{first['id']}/twin",
        json={"other_order_id": different["id"]},
        headers=dispatcher_headers,
    )
    assert mismatch.status_code == 422


async def test_import_is_idempotent_and_dispatcher_only(app_with_client: AppClient) -> None:
    app, client = app_with_client
    await _create_user(app, "7103000060", UserRole.dispatcher)
    await _create_user(app, "7103000061", UserRole.client)
    dispatcher_headers = await _headers(client, "7103000060")
    client_headers = await _headers(client, "7103000061")
    rows = [
        {
            "fio": "Imported One",
            "from_addr": "A",
            "to_addr": "B",
            "time": "08:20",
            "phone": "+7 710 399 00 01",
            "pickup_lat": 47.1,
            "pickup_lon": 51.9,
            "dropoff_lat": 47.2,
            "dropoff_lon": 52.0,
            "external_id": "p3-import-001",
            "escort_note": "с сопровождением",
        },
        {
            "fio": "Imported Two",
            "from_addr": "C",
            "to_addr": "D",
            "time": "12:45",
            "phone": "87103990002",
            "external_id": "p3-import-002",
            "escort_note": "без сопровождения",
        },
    ]

    forbidden = await client.post("/api/v1/orders/import", json=rows, headers=client_headers)
    assert forbidden.status_code == 403
    first = await client.post(
        "/api/v1/orders/import", json=rows, headers=dispatcher_headers
    )
    assert first.status_code == 200, first.text
    assert first.json() == {"created": 2, "skipped": 0, "errors": []}
    repeated = await client.post(
        "/api/v1/orders/import", json=rows, headers=dispatcher_headers
    )
    assert repeated.status_code == 200, repeated.text
    assert repeated.json() == {"created": 0, "skipped": 2, "errors": []}
