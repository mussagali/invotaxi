"""Strict minivan contract ported from the supplied routing toolkit."""

from dataclasses import replace

from routing import DriverIn, DriverPosition, EngineConfig, OrderIn, online_insert, solve
from routing.core import RouteState
from routing.geo import AtyrauDistanceProvider
from routing.minivans import build_minivan_runs, minivan_group_is_valid


def _order(
    order_id: str,
    t_min: int,
    *,
    pickup_lat: float = 47.100,
    pickup_lon: float = 51.900,
    dropoff_lat: float = 47.180,
    dropoff_lon: float = 51.900,
) -> OrderIn:
    return OrderIn(
        order_id,
        t_min,
        pickup_lat,
        pickup_lon,
        dropoff_lat,
        dropoff_lon,
        1,
        region="r",
    )


def test_minivan_group_requires_every_toolkit_constraint() -> None:
    cfg = EngineConfig(n_rental=0)
    distance = AtyrauDistanceProvider()
    orders = {
        "a": _order("a", 450),
        "b": _order("b", 458, pickup_lat=47.101),
        "c": _order("c", 465, pickup_lon=51.901),
    }
    assert minivan_group_is_valid(orders, orders, cfg, distance)

    variants = (
        replace(orders["c"], t_min=466),
        replace(orders["c"], pickup_lat=47.130),
        replace(orders["c"], dropoff_lat=47.020),
        replace(orders["c"], dropoff_lat=47.110),
        replace(orders["c"], t_min=600),
    )
    for invalid in variants:
        candidate = {**orders, "c": invalid}
        assert not minivan_group_is_valid(candidate, candidate, cfg, distance)


def test_minivan_prefers_three_never_solo_and_is_not_used_for_online_insert() -> None:
    cfg = EngineConfig(n_rental=0, min_orders=1)
    distance = AtyrauDistanceProvider()
    driver = DriverIn("mini", "r", 6, 47.100, 51.900)
    orders = {
        "a": _order("a", 450),
        "b": _order("b", 458, pickup_lat=47.101),
        "c": _order("c", 465, pickup_lon=51.901),
    }
    route = RouteState(driver)
    assert build_minivan_runs(route, set(orders), orders, cfg, distance) == set(orders)
    assert [len(block.order_ids) for block in route.blocks] == [3]

    solo_route = RouteState(driver)
    assert build_minivan_runs(solo_route, {"a"}, orders, cfg, distance) == set()
    assert solo_route.blocks == []

    empty = solve([], [driver], cfg)
    inserted = online_insert(
        empty,
        orders["a"],
        {"mini": DriverPosition(47.100, 51.900)},
    )
    assert inserted.unassigned == {"a"}
    assert inserted.routes["mini"] == []
