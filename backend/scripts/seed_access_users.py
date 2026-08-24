"""Create or update the requested admin-panel accounts.

Run inside the API container after migrations:
    docker compose exec api python scripts/seed_access_users.py

The temporary PIN is intentionally limited to the current launch phase and
must be rotated before exposing the service to the internet.
"""

import asyncio
import os

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.security import hash_password, normalize_phone
from app.domain.enums import UserRole, UserStatus
from app.domain.models import User

TEMPORARY_PASSWORD = os.environ.get("ACCESS_USERS_PASSWORD", "1111")
ACCESS_USERS = (
    ("+77755777584", "Диар", UserRole.admin),
    ("+77784906550", "Айболат", UserRole.admin),
    ("+77753454748", "Арсен", UserRole.dispatcher),
    ("+77714592754", "Бекболат", UserRole.dispatcher),
)


ACCESS_USERS = tuple(
    (
        phone,
        full_name,
        UserRole.admin
        if phone in {"+77755777584", "+77753454748"}
        else UserRole.dispatcher,
    )
    for phone, full_name, _role in ACCESS_USERS
)


async def seed(session: AsyncSession) -> None:
    for raw_phone, full_name, role in ACCESS_USERS:
        phone = normalize_phone(raw_phone)
        user = await session.scalar(select(User).where(User.phone == phone))
        if user is None:
            user = User(
                phone=phone,
                full_name=full_name,
                password_hash=hash_password(TEMPORARY_PASSWORD),
                role=role,
                status=UserStatus.active,
            )
            session.add(user)
        else:
            user.full_name = full_name
            user.role = role
            user.status = UserStatus.active
            user.password_hash = hash_password(TEMPORARY_PASSWORD)
    await session.commit()
    print("access users ready: 2 admins, 2 dispatchers")


async def main() -> None:
    if os.environ.get("ENV", "dev") != "dev" and os.environ.get(
        "ALLOW_PRODUCTION_ACCESS_SEED", ""
    ).lower() != "true":
        print("access users seed skipped outside dev")
        return
    engine = create_async_engine(os.environ["DATABASE_URL"])
    try:
        async with AsyncSession(engine) as session:
            await seed(session)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
