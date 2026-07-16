from datetime import UTC, date, datetime, time

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.domain.enums import UserRole
from app.domain.models import ClientProfile, DriverTrackHistory, Order, User
from app.domain.partitions import ensure_track_history_partition


async def _make_client(session: AsyncSession, phone: str) -> ClientProfile:
    user = User(phone=phone, password_hash="x", role=UserRole.client)
    session.add(user)
    await session.flush()
    profile = ClientProfile(user_id=user.id, full_name="Test Client")
    session.add(profile)
    await session.flush()
    return profile


async def test_order_seats_check_constraint(migrated_db: str) -> None:
    engine = create_async_engine(migrated_db)
    try:
        async with AsyncSession(engine) as session:
            client = await _make_client(session, "7090000001")
            session.add(
                Order(
                    client_id=client.user_id,
                    service_date=date(2026, 7, 16),
                    desired_time=time(10, 0),
                    seats=3,
                )
            )
            with pytest.raises(IntegrityError, match="seats_1_or_2"):
                await session.flush()
    finally:
        await engine.dispose()


async def test_duplicate_phone_rejected(migrated_db: str) -> None:
    engine = create_async_engine(migrated_db)
    try:
        async with AsyncSession(engine) as session:
            session.add(User(phone="7090000002", password_hash="x", role=UserRole.client))
            await session.flush()
            session.add(User(phone="7090000002", password_hash="y", role=UserRole.driver))
            with pytest.raises(IntegrityError):
                await session.flush()
    finally:
        await engine.dispose()


async def test_track_history_partition_created_for_date(migrated_db: str) -> None:
    engine = create_async_engine(migrated_db)
    day = date(2026, 7, 20)
    try:
        async with AsyncSession(engine) as session:
            user = User(phone="7090000003", password_hash="x", role=UserRole.driver)
            session.add(user)
            await session.flush()
            driver_id = user.id
            await session.execute(
                text(
                    "INSERT INTO drivers (user_id, full_name, region, capacity) "
                    "VALUES (:uid, 'D', 'Центр', 4)"
                ),
                {"uid": str(driver_id)},
            )
            await session.commit()

        # Insert without partition must fail
        async with engine.connect() as conn:
            with pytest.raises(DBAPIError):
                await conn.execute(
                    text(
                        "INSERT INTO driver_track_history (driver_id, ts, lat, lon) "
                        "VALUES (:d, :ts, 47.0, 51.9)"
                    ),
                    {"d": str(driver_id), "ts": datetime(2026, 7, 20, 8, 0, tzinfo=UTC)},
                )

        async with engine.begin() as conn:
            name = await ensure_track_history_partition(conn, day)
            assert name == "driver_track_history_20260720"
            # idempotent
            await ensure_track_history_partition(conn, day)

        async with AsyncSession(engine) as session:
            session.add(
                DriverTrackHistory(
                    driver_id=driver_id,
                    ts=datetime(2026, 7, 20, 8, 0, tzinfo=UTC),
                    lat=47.09,
                    lon=51.92,
                )
            )
            await session.commit()
            count = (
                await session.execute(
                    select(func.count()).select_from(DriverTrackHistory)
                )
            ).scalar_one()
            assert count == 1
    finally:
        await engine.dispose()
