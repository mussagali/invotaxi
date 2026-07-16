"""Partition management for driver_track_history (RANGE on ts, one per day)."""
from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection


def track_history_partition_name(day: date) -> str:
    return f"driver_track_history_{day:%Y%m%d}"


async def ensure_track_history_partition(conn: AsyncConnection, day: date) -> str:
    """Create the daily partition if missing. Idempotent."""
    name = track_history_partition_name(day)
    start = day.isoformat()
    end = (day + timedelta(days=1)).isoformat()
    await conn.execute(
        text(
            f"CREATE TABLE IF NOT EXISTS {name} "
            f"PARTITION OF driver_track_history "
            f"FOR VALUES FROM ('{start}') TO ('{end}')"
        )
    )
    return name
