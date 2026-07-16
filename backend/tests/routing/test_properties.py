"""Property checks for partition and validator invariants."""

from __future__ import annotations

import pytest

from routing import DriverIn, EngineConfig, OrderIn, solve

try:
    from hypothesis import given, settings
    from hypothesis import strategies as st
except ImportError:
    pytest.skip("hypothesis optional dependency is not installed", allow_module_level=True)


@settings(max_examples=30, deadline=None)
@given(
    times=st.lists(st.integers(min_value=480, max_value=1050), min_size=1, max_size=20),
    seats=st.lists(st.integers(min_value=1, max_value=4), min_size=1, max_size=20),
)
def test_valid_inputs_always_form_valid_partition(times: list[int], seats: list[int]) -> None:
    count = min(len(times), len(seats))
    orders = [
        OrderIn(
            f"o{index}",
            times[index],
            47.10 + index * 0.0001,
            51.90,
            47.101 + index * 0.0001,
            51.901,
            seats[index],
            region="r",
        )
        for index in range(count)
    ]
    drivers = [DriverIn(f"d{index}", "r", 4, 47.1, 51.9) for index in range(5)]
    solution = solve(orders, drivers, EngineConfig(min_orders=1, n_rental=1))
    assigned = {
        order_id
        for blocks in solution.routes.values()
        for block in blocks
        for order_id in block.order_ids
    }
    assert solution.validation.is_valid
    assert assigned.isdisjoint(solution.unassigned)
    assert assigned | solution.unassigned == {item.id for item in orders}
