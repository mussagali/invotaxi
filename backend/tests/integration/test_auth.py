import uuid
from datetime import date, time

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select

from app.core.security import hash_password
from app.domain.enums import UserRole
from app.domain.models import ClientProfile, Driver, Order, User

AppClient = tuple[FastAPI, httpx.AsyncClient]

PASSWORD = "correct-horse-9"


async def _create_user(app: FastAPI, phone: str, role: UserRole) -> uuid.UUID:
    async with app.state.session_factory() as session:
        user = User(phone=phone, password_hash=hash_password(PASSWORD), role=role)
        session.add(user)
        await session.flush()
        if role == UserRole.client:
            session.add(ClientProfile(user_id=user.id, full_name="Test Client"))
        elif role == UserRole.driver:
            session.add(
                Driver(
                    user_id=user.id,
                    full_name="Test Driver",
                    region="Атырау",
                    capacity=4,
                )
            )
        user_id = user.id
        await session.commit()
    return user_id


async def _login(client: httpx.AsyncClient, phone: str, password: str = PASSWORD) -> httpx.Response:
    return await client.post("/api/v1/auth/login", json={"phone": phone, "password": password})


async def test_login_me_and_phone_normalization(app_with_client: AppClient) -> None:
    app, client = app_with_client
    user_id = await _create_user(app, "7031000001", UserRole.client)

    user_ids = set()
    for variant in ("87031000001", "+77031000001", "7031000001"):
        resp = await _login(client, variant)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        user_ids.add(body["user"]["id"])
        assert body["tokens"]["access_token"]

    assert user_ids == {str(user_id)}

    access = resp.json()["tokens"]["access_token"]
    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert me.status_code == 200
    assert me.json()["user"]["phone"] == "7031000001"
    assert me.json()["client_profile"]["full_name"] == "Test Client"


async def test_user_can_update_own_profile_name(app_with_client: AppClient) -> None:
    app, client = app_with_client
    user_id = await _create_user(app, "7031000099", UserRole.client)
    login = await _login(client, "7031000099")
    access = login.json()["tokens"]["access_token"]
    headers = {"Authorization": f"Bearer {access}"}

    updated = await client.patch(
        "/api/v1/auth/me",
        json={"full_name": "  Новое Имя  "},
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["user"]["full_name"] == "Новое Имя"
    assert updated.json()["client_profile"]["full_name"] == "Новое Имя"

    async with app.state.session_factory() as session:
        user = await session.get(User, user_id)
        profile = await session.get(ClientProfile, user_id)
        assert user is not None and user.full_name == "Новое Имя"
        assert profile is not None and profile.full_name == "Новое Имя"


async def test_driver_can_update_detected_city(app_with_client: AppClient) -> None:
    app, client = app_with_client
    user_id = await _create_user(app, "7031000098", UserRole.driver)
    login = await _login(client, "7031000098")
    headers = {"Authorization": f"Bearer {login.json()['tokens']['access_token']}"}

    updated = await client.patch(
        "/api/v1/auth/me",
        json={"region": "Астана"},
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["driver_profile"]["region"] == "Астана"

    async with app.state.session_factory() as session:
        driver = await session.get(Driver, user_id)
        assert driver is not None and driver.region == "Астана"


async def test_client_cannot_update_driver_region(app_with_client: AppClient) -> None:
    app, client = app_with_client
    await _create_user(app, "7031000097", UserRole.client)
    login = await _login(client, "7031000097")
    headers = {"Authorization": f"Bearer {login.json()['tokens']['access_token']}"}

    updated = await client.patch(
        "/api/v1/auth/me",
        json={"region": "Алматы"},
        headers=headers,
    )
    assert updated.status_code == 422


async def test_login_wrong_password_401(app_with_client: AppClient) -> None:
    app, client = app_with_client
    await _create_user(app, "7031000002", UserRole.client)
    resp = await _login(client, "7031000002", "wrong-password")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "http_401"


async def test_dev_login_is_disabled_by_default(app_with_client: AppClient) -> None:
    _, client = app_with_client
    resp = await client.post(
        "/api/v1/auth/dev-login",
        json={"phone": "7031999901", "password": "1111", "role": "client"},
    )
    assert resp.status_code == 404


async def test_dev_login_creates_profile_when_explicitly_enabled(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    app.state.settings.dev_auto_register = True
    app.state.settings.dev_app_password = "1111"
    try:
        resp = await client.post(
            "/api/v1/auth/dev-login",
            json={"phone": "+7 703 199 99 02", "password": "1111", "role": "client"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["user"]["role"] == "client"
        access = resp.json()["tokens"]["access_token"]
        me = await client.get(
            "/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"}
        )
        assert me.status_code == 200
        assert me.json()["client_profile"]["full_name"].endswith("9902")
    finally:
        app.state.settings.dev_auto_register = False
        app.state.settings.dev_app_password = ""


async def test_me_without_token_401(app_with_client: AppClient) -> None:
    _, client = app_with_client
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 401


async def test_refresh_rotation_and_reuse_kills_all_sessions(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    await _create_user(app, "7031000003", UserRole.client)

    login = await _login(client, "7031000003")
    refresh1 = login.json()["tokens"]["refresh_token"]

    # Rotation: first use works and returns a new pair.
    r1 = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh1})
    assert r1.status_code == 200
    access2, refresh2 = r1.json()["access_token"], r1.json()["refresh_token"]
    assert refresh2 != refresh1

    # Re-use of the consumed token: 401 + every session is revoked.
    r2 = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh1})
    assert r2.status_code == 401

    r3 = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh2})
    assert r3.status_code == 401

    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access2}"})
    assert me.status_code == 401


async def test_logout_blacklists_access(app_with_client: AppClient) -> None:
    app, client = app_with_client
    await _create_user(app, "7031000004", UserRole.client)
    login = await _login(client, "7031000004")
    access = login.json()["tokens"]["access_token"]
    headers = {"Authorization": f"Bearer {access}"}

    assert (await client.get("/api/v1/auth/me", headers=headers)).status_code == 200
    assert (await client.post("/api/v1/auth/logout", headers=headers)).status_code == 204
    assert (await client.get("/api/v1/auth/me", headers=headers)).status_code == 401


async def test_delete_account_anonymizes_client_and_revokes_session(
    app_with_client: AppClient,
) -> None:
    app, client = app_with_client
    user_id = await _create_user(app, "7031000044", UserRole.client)
    async with app.state.session_factory() as session:
        session.add(
            Order(
                client_id=user_id,
                service_date=date.today(),
                desired_time=time(12, 0),
                pickup_addr="Private pickup",
                dropoff_addr="Private dropoff",
            )
        )
        await session.commit()

    login = await _login(client, "7031000044")
    access = login.json()["tokens"]["access_token"]
    headers = {"Authorization": f"Bearer {access}"}
    deleted = await client.delete("/api/v1/auth/me", headers=headers)
    assert deleted.status_code == 204, deleted.text
    assert (await client.get("/api/v1/auth/me", headers=headers)).status_code == 401
    assert (await _login(client, "7031000044")).status_code == 401

    async with app.state.session_factory() as session:
        user = await session.get(User, user_id)
        profile = await session.get(ClientProfile, user_id)
        order = (
            await session.execute(select(Order).where(Order.client_id == user_id))
        ).scalar_one()
        assert user is not None and user.phone.startswith("deleted-")
        assert profile is not None and profile.full_name == "Удалённый пользователь"
        assert order.pickup_addr is None and order.dropoff_addr is None


async def test_create_user_requires_dispatcher_role(app_with_client: AppClient) -> None:
    app, client = app_with_client
    await _create_user(app, "7031000005", UserRole.client)
    login = await _login(client, "7031000005")
    access = login.json()["tokens"]["access_token"]

    payload = {
        "phone": "7031000006",
        "password": "new-password-1",
        "role": "client",
        "client_profile": {"full_name": "New"},
    }
    # client role -> 403
    resp = await client.post(
        "/api/v1/auth/users", json=payload, headers={"Authorization": f"Bearer {access}"}
    )
    assert resp.status_code == 403
    # no token -> 401
    resp = await client.post("/api/v1/auth/users", json=payload)
    assert resp.status_code == 401


async def test_dispatcher_creates_driver_with_argon2_hash(app_with_client: AppClient) -> None:
    app, client = app_with_client
    await _create_user(app, "7031000007", UserRole.dispatcher)
    login = await _login(client, "7031000007")
    access = login.json()["tokens"]["access_token"]

    resp = await client.post(
        "/api/v1/auth/users",
        json={
            "phone": "+7 703 100 00 08",
            "password": "driver-pass-123",
            "role": "driver",
            "driver_profile": {"full_name": "Новый Водитель", "region": "Центр", "capacity": 4},
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["user"]["phone"] == "7031000008"

    # duplicate phone -> 409
    resp2 = await client.post(
        "/api/v1/auth/users",
        json={
            "phone": "87031000008",
            "password": "driver-pass-123",
            "role": "driver",
            "driver_profile": {"full_name": "Дубль", "region": "Центр", "capacity": 4},
        },
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp2.status_code == 409

    # stored hash is argon2, never the raw password
    async with app.state.session_factory() as session:
        user = (
            await session.execute(select(User).where(User.phone == "7031000008"))
        ).scalar_one()
        assert user.password_hash.startswith("$argon2")
        assert "driver-pass-123" not in user.password_hash

    # the created driver can log in
    assert (await _login(client, "87031000008", "driver-pass-123")).status_code == 200

    # invalid payload: driver without profile -> 422
    resp3 = await client.post(
        "/api/v1/auth/users",
        json={"phone": "7031000009", "password": "driver-pass-123", "role": "driver"},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert resp3.status_code == 422


async def test_login_rate_limit_429(app_with_client: AppClient) -> None:
    app, client = app_with_client
    await _create_user(app, "7031000010", UserRole.client)

    for _ in range(5):
        resp = await _login(client, "7031000010", "wrong")
        assert resp.status_code == 401

    resp = await _login(client, "7031000010", "wrong")
    assert resp.status_code == 429
    assert int(resp.headers["Retry-After"]) >= 1

    # correct password is also blocked while the window lasts
    resp = await _login(client, "7031000010", PASSWORD)
    assert resp.status_code == 429


@pytest.mark.parametrize("token", ["not-a-jwt", ""])
async def test_malformed_bearer_401(app_with_client: AppClient, token: str) -> None:
    _, client = app_with_client
    resp = await client.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 401
