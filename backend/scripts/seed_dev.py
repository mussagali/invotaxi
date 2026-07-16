"""Dev seed: districts, drivers, clients, orders for tomorrow. Idempotent.

Run inside the api container:
    docker compose exec api python scripts/seed_dev.py
"""
import asyncio
import os
import random
import uuid
from datetime import date, time, timedelta

from argon2 import PasswordHasher
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.domain.enums import UserRole
from app.domain.models import ClientProfile, Driver, Order, User

# Atyrau bbox (P1 prompt)
LAT_MIN, LAT_MAX = 46.85, 47.35
LON_MIN, LON_MAX = 51.55, 52.15

DISTRICTS = ["Центр", "Жилгородок", "Балыкши"]

ADMIN_PHONE = "7000000001"
DISPATCHER_PHONE = "7000000002"

N_DRIVERS = 20
N_MINIVANS = 4
N_CLIENTS = 60
N_ORDERS = 150

SEED_NAMESPACE = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")


def _twin_group(tag: str) -> uuid.UUID:
    return uuid.uuid5(SEED_NAMESPACE, f"seed-twin-{tag}")


async def seed(session: AsyncSession) -> None:
    rng = random.Random(42)
    ph = PasswordHasher()
    admin_hash = ph.hash(os.environ["SEED_ADMIN_PASSWORD"])
    user_hash = ph.hash(os.environ.get("SEED_USER_PASSWORD", "dev-only-password"))

    users_rows: list[dict] = [
        {"phone": ADMIN_PHONE, "password_hash": admin_hash, "role": UserRole.admin},
        {"phone": DISPATCHER_PHONE, "password_hash": admin_hash, "role": UserRole.dispatcher},
    ]
    driver_phones = [f"701{i:07d}" for i in range(1, N_DRIVERS + 1)]
    client_phones = [f"702{i:07d}" for i in range(1, N_CLIENTS + 1)]
    users_rows += [
        {"phone": p, "password_hash": user_hash, "role": UserRole.driver}
        for p in driver_phones
    ]
    users_rows += [
        {"phone": p, "password_hash": user_hash, "role": UserRole.client}
        for p in client_phones
    ]
    await session.execute(
        pg_insert(User).values(users_rows).on_conflict_do_nothing(index_elements=["phone"])
    )

    phone_to_id = {
        phone: user_id
        for user_id, phone in (await session.execute(select(User.id, User.phone))).all()
    }
    dispatcher_id = phone_to_id[DISPATCHER_PHONE]

    driver_rows = []
    for i, phone in enumerate(driver_phones):
        driver_rows.append(
            {
                "user_id": phone_to_id[phone],
                "full_name": f"Водитель {i + 1}",
                "region": DISTRICTS[i % len(DISTRICTS)],
                "vehicle_model": "Hyundai Staria" if i < N_MINIVANS else "Hyundai Accent",
                "plate": f"{100 + i} KZ 06",
                "capacity": 6 if i < N_MINIVANS else 4,
                "shift_start": time(7, 0),
                "shift_end": time(19, 0),
                "home_lat": rng.uniform(LAT_MIN, LAT_MAX),
                "home_lon": rng.uniform(LON_MIN, LON_MAX),
            }
        )
    await session.execute(
        pg_insert(Driver).values(driver_rows).on_conflict_do_nothing(index_elements=["user_id"])
    )

    client_rows = []
    for i, phone in enumerate(client_phones):
        client_rows.append(
            {
                "user_id": phone_to_id[phone],
                "full_name": f"Клиент {i + 1}",
                "needs_escort": i % 5 == 0,
            }
        )
    await session.execute(
        pg_insert(ClientProfile)
        .values(client_rows)
        .on_conflict_do_nothing(index_elements=["user_id"])
    )

    tomorrow = date.today() + timedelta(days=1)
    order_rows = []
    for i in range(N_ORDERS):
        client_phone = client_phones[rng.randrange(N_CLIENTS)]
        escort = rng.random() < 0.2
        minute = rng.randrange(7 * 60, 19 * 60)
        order_rows.append(
            {
                "external_id": f"seed-order-{i + 1:04d}",
                "client_id": phone_to_id[client_phone],
                "created_by": dispatcher_id,
                "service_date": tomorrow,
                "desired_time": time(minute // 60, minute % 60),
                "pickup_addr": f"Атырау, ул. Сатпаева {i + 1}",
                "pickup_lat": rng.uniform(LAT_MIN, LAT_MAX),
                "pickup_lon": rng.uniform(LON_MIN, LON_MAX),
                "dropoff_addr": f"Атырау, пр. Азаттык {i + 1}",
                "dropoff_lat": rng.uniform(LAT_MIN, LAT_MAX),
                "dropoff_lon": rng.uniform(LON_MIN, LON_MAX),
                "escort": escort,
                "seats": 2 if escort else 1,
                "twin_group_id": None,
            }
        )
    # Two twin pairs: same twin_group_id, same pickup, same desired_time.
    for pair, (a, b) in enumerate([(0, 1), (2, 3)], start=1):
        group = _twin_group(str(pair))
        for j in (a, b):
            order_rows[j]["twin_group_id"] = group
            order_rows[j]["desired_time"] = time(9, 0)
            order_rows[j]["pickup_lat"] = order_rows[a]["pickup_lat"]
            order_rows[j]["pickup_lon"] = order_rows[a]["pickup_lon"]
            order_rows[j]["pickup_addr"] = order_rows[a]["pickup_addr"]
        # twins are different clients by construction of the seed data
        order_rows[b]["client_id"] = phone_to_id[client_phones[(pair * 7) % N_CLIENTS]]
        if order_rows[a]["client_id"] == order_rows[b]["client_id"]:
            order_rows[b]["client_id"] = phone_to_id[client_phones[(pair * 7 + 1) % N_CLIENTS]]

    await session.execute(
        pg_insert(Order)
        .values(order_rows)
        .on_conflict_do_nothing(index_elements=["external_id"])
    )

    users_count = (await session.execute(select(func.count()).select_from(User))).scalar_one()
    orders_count = (await session.execute(select(func.count()).select_from(Order))).scalar_one()
    print(f"seed done: users={users_count} orders={orders_count}")


async def main() -> None:
    engine = create_async_engine(os.environ["DATABASE_URL"])
    try:
        async with AsyncSession(engine) as session, session.begin():
            await seed(session)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
