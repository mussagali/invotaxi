"""Idempotent P9 load seed: personas plus exactly 600 dispatch orders.

Run inside the API container:
    docker compose exec api python scripts/seed_load.py
"""

import asyncio
import os
import random
from datetime import date, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.security import hash_password
from app.domain.enums import UserRole
from app.domain.models import ClientProfile, Driver, Order, User

LAT_MIN, LAT_MAX = 46.85, 47.35
LON_MIN, LON_MAX = 51.55, 52.15
DISTRICT = "Центр"

N_DRIVERS = 250
N_CLIENTS = 1100
N_DISPATCHERS = 150
N_ORDERS = 600
LOGIN_ACCOUNT_POOL = 2000
DISPATCH_JOB_PHONE = "7047999999"


async def seed(session: AsyncSession) -> None:
    rng = random.Random(9001)
    # Argon2 is intentionally invoked once: every load user shares this hash.
    password_hash = hash_password(os.environ["SEED_USER_PASSWORD"])

    # k6 VU IDs are global across executors, not local to each persona. A pool
    # larger than the matrix-wide max VUs prevents modulo collisions while the
    # actual workload remains 250 drivers / 1100 clients / 150 dispatcher RPM.
    driver_phones = [f"7048{i:06d}" for i in range(1, LOGIN_ACCOUNT_POOL + 1)]
    client_phones = [f"7049{i:06d}" for i in range(1, LOGIN_ACCOUNT_POOL + 1)]
    dispatcher_phones = [f"7047{i:06d}" for i in range(1, LOGIN_ACCOUNT_POOL + 1)]
    user_rows = [
        {
            "phone": DISPATCH_JOB_PHONE,
            "password_hash": password_hash,
            "role": UserRole.dispatcher,
        },
        *(
            {"phone": phone, "password_hash": password_hash, "role": UserRole.dispatcher}
            for phone in dispatcher_phones
        ),
        *(
            {"phone": phone, "password_hash": password_hash, "role": UserRole.driver}
            for phone in driver_phones
        ),
        *(
            {"phone": phone, "password_hash": password_hash, "role": UserRole.client}
            for phone in client_phones
        ),
    ]
    await session.execute(
        pg_insert(User).values(user_rows).on_conflict_do_nothing(index_elements=["phone"])
    )

    phone_to_id = {
        phone: user_id
        for user_id, phone in (
            await session.execute(
                select(User.id, User.phone).where(
                    User.phone.in_(
                        [DISPATCH_JOB_PHONE, *dispatcher_phones, *driver_phones, *client_phones]
                    )
                )
            )
        ).all()
    }
    dispatcher_id = phone_to_id[DISPATCH_JOB_PHONE]

    driver_rows = [
        {
            "user_id": phone_to_id[phone],
            "full_name": f"Нагрузочный водитель {index}",
            "region": DISTRICT,
            "vehicle_model": "Hyundai Accent",
            "plate": f"{index:03d} LT 06",
            "capacity": 4,
            "is_online": True,
            "shift_start": time(7),
            "shift_end": time(19),
            "home_lat": rng.uniform(LAT_MIN, LAT_MAX),
            "home_lon": rng.uniform(LON_MIN, LON_MAX),
        }
        for index, phone in enumerate(driver_phones[:N_DRIVERS], start=1)
    ]
    await session.execute(
        pg_insert(Driver)
        .values(driver_rows)
        .on_conflict_do_update(
            index_elements=["user_id"],
            set_={"is_online": True, "region": DISTRICT},
        )
    )

    client_rows = [
        {
            "user_id": phone_to_id[phone],
            "full_name": f"Нагрузочный клиент {index}",
            "needs_escort": index % 5 == 0,
        }
        for index, phone in enumerate(client_phones, start=1)
    ]
    await session.execute(
        pg_insert(ClientProfile)
        .values(client_rows)
        .on_conflict_do_nothing(index_elements=["user_id"])
    )

    tomorrow = date.today() + timedelta(days=1)
    order_rows = []
    for index in range(1, N_ORDERS + 1):
        minute = rng.randrange(7 * 60, 19 * 60)
        escort = index % 5 == 0
        order_rows.append(
            {
                "external_id": f"load-order-{tomorrow.isoformat()}-{index:04d}",
                "client_id": phone_to_id[client_phones[(index - 1) % N_CLIENTS]],
                "created_by": dispatcher_id,
                "service_date": tomorrow,
                "desired_time": time(minute // 60, minute % 60),
                "pickup_addr": f"Атырау, нагрузочная точка {index}",
                "pickup_lat": rng.uniform(LAT_MIN, LAT_MAX),
                "pickup_lon": rng.uniform(LON_MIN, LON_MAX),
                "dropoff_addr": f"Атырау, нагрузочная цель {index}",
                "dropoff_lat": rng.uniform(LAT_MIN, LAT_MAX),
                "dropoff_lon": rng.uniform(LON_MIN, LON_MAX),
                "escort": escort,
                "seats": 2 if escort else 1,
            }
        )
    await session.execute(
        pg_insert(Order)
        .values(order_rows)
        .on_conflict_do_nothing(index_elements=["external_id"])
    )

    await session.commit()
    users = (
        await session.execute(
            select(func.count()).select_from(User).where(
                User.phone.in_([*dispatcher_phones, *driver_phones, *client_phones])
            )
        )
    ).scalar_one()
    orders = (
        await session.execute(
            select(func.count()).select_from(Order).where(
                Order.external_id.like(f"load-order-{tomorrow.isoformat()}-%")
            )
        )
    ).scalar_one()
    print(
        "load seed done: "
        f"users={users} login_accounts_per_persona={LOGIN_ACCOUNT_POOL} "
        f"online_drivers={N_DRIVERS} client_vus={N_CLIENTS} "
        f"dispatcher_rpm={N_DISPATCHERS} orders={orders}"
    )


async def main() -> None:
    engine = create_async_engine(os.environ["DATABASE_URL"])
    try:
        async with AsyncSession(engine) as session:
            await seed(session)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
