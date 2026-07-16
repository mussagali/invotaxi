import uuid
from datetime import date, timedelta

import httpx
from fastapi import FastAPI

from app.core.security import hash_password
from app.domain.enums import UserRole
from app.domain.models import ClientProfile, User

AppClient = tuple[FastAPI, httpx.AsyncClient]
PASSWORD = "family-test-password"


async def _client(app: FastAPI, phone: str) -> uuid.UUID:
    async with app.state.session_factory() as session:
        user = User(phone=phone, password_hash=hash_password(PASSWORD), role=UserRole.client)
        session.add(user)
        await session.flush()
        session.add(ClientProfile(user_id=user.id, full_name=f"Guardian {phone}"))
        await session.commit()
        return user.id


async def _headers(client: httpx.AsyncClient, phone: str) -> dict[str, str]:
    response = await client.post(
        "/api/v1/auth/login", json={"phone": phone, "password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['tokens']['access_token']}"}


async def test_guardian_creates_children_and_one_family_order(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    await _client(app, "7105000001")
    headers = await _headers(client, "7105000001")

    first = await client.post(
        "/api/v1/dependents",
        json={"full_name": "Алия Т.", "needs_escort": False},
        headers=headers,
    )
    second = await client.post(
        "/api/v1/dependents",
        json={"full_name": "Марат Т.", "needs_escort": True},
        headers=headers,
    )
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text

    listed = await client.get("/api/v1/dependents", headers=headers)
    assert listed.status_code == 200
    assert [item["full_name"] for item in listed.json()] == ["Алия Т.", "Марат Т."]

    order = await client.post(
        "/api/v1/orders",
        json={
            "service_date": str(date.today() + timedelta(days=2)),
            "desired_time": "09:30",
            "pickup_addr": "Астана, улица Абая 1",
            "pickup_lat": 51.1694,
            "pickup_lon": 71.4491,
            "dropoff_addr": "Астана, школа 2",
            "dropoff_lat": 51.1510,
            "dropoff_lon": 71.4200,
            "dependent_ids": [first.json()["id"], second.json()["id"]],
        },
        headers=headers,
    )
    assert order.status_code == 201, order.text
    body = order.json()
    assert body["passenger_names"] == ["Алия Т.", "Марат Т."]
    assert len(body["dependent_ids"]) == 2
    assert body["escort"] is True
    assert body["seats"] == 3

async def test_guardian_cannot_order_for_another_clients_child(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    await _client(app, "7105000002")
    await _client(app, "7105000003")
    owner_headers = await _headers(client, "7105000002")
    other_headers = await _headers(client, "7105000003")
    child = await client.post(
        "/api/v1/dependents",
        json={"full_name": "Чужой ребёнок"},
        headers=owner_headers,
    )
    assert child.status_code == 201

    response = await client.post(
        "/api/v1/orders",
        json={
            "service_date": str(date.today() + timedelta(days=2)),
            "desired_time": "09:30",
            "pickup_addr": "Астана, улица Абая 1",
            "dropoff_addr": "Астана, школа 2",
            "dependent_ids": [child.json()["id"]],
        },
        headers=other_headers,
    )
    assert response.status_code == 422
