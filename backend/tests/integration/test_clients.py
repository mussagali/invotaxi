import uuid
from datetime import date, time

import httpx
from fastapi import FastAPI

from app.core.security import hash_password
from app.domain.enums import UserRole
from app.domain.models import ClientProfile, Order, User

PASSWORD = "correct-horse-9"
AppClient = tuple[FastAPI, httpx.AsyncClient]


async def _user(app: FastAPI, phone: str, role: UserRole) -> uuid.UUID:
    async with app.state.session_factory() as session:
        user = User(phone=phone, password_hash=hash_password(PASSWORD), role=role)
        session.add(user)
        await session.flush()
        if role == UserRole.client:
            session.add(
                ClientProfile(
                    user_id=user.id,
                    full_name="Иван Клиент",
                    needs_escort=True,
                )
            )
        await session.commit()
        return user.id


async def _headers(client: httpx.AsyncClient, phone: str) -> dict[str, str]:
    response = await client.post(
        "/api/v1/auth/login",
        json={"phone": phone, "password": PASSWORD},
    )
    return {"Authorization": f"Bearer {response.json()['tokens']['access_token']}"}


async def test_dispatcher_lists_stats_and_patches_clients(app_with_client: AppClient) -> None:
    app, client = app_with_client
    await _user(app, "7031555001", UserRole.dispatcher)
    client_id = await _user(app, "7031555002", UserRole.client)
    async with app.state.session_factory() as session:
        session.add(
            Order(
                client_id=client_id,
                service_date=date.today(),
                desired_time=time(10, 0),
                pickup_addr="A",
                dropoff_addr="B",
            )
        )
        await session.commit()
    headers = await _headers(client, "7031555001")

    listing = await client.get("/api/v1/clients?search=Иван", headers=headers)
    assert listing.status_code == 200, listing.text
    assert listing.json()[0]["user_id"] == str(client_id)
    assert listing.json()[0]["orders_count"] == 1

    stats = await client.get("/api/v1/clients/stats", headers=headers)
    assert stats.status_code == 200, stats.text
    assert stats.json()["total"] >= 1
    assert stats.json()["with_companion"] >= 1
    assert stats.json()["total_orders"] >= 1
    assert stats.json()["category_i"] == 0

    changed = await client.patch(
        f"/api/v1/clients/{client_id}",
        json={"full_name": "Новое имя", "needs_escort": False},
        headers=headers,
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["full_name"] == "Новое имя"
    assert changed.json()["needs_escort"] is False
