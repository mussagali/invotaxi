from datetime import time

from app.services.reports import aggregate_unassigned


def test_aggregate_unassigned_uses_half_hour_slots_and_districts() -> None:
    rows = [
        (time(12, 0), "central"),
        (time(12, 29), "central"),
        (time(12, 30), "central"),
        (time(12, 44), "west"),
        (time(13, 0), "west"),
    ]

    assert aggregate_unassigned(rows) == {
        "12:00-12:30": {"central": 2},
        "12:30-13:00": {"central": 1, "west": 1},
        "13:00-13:30": {"west": 1},
    }
