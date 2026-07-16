"""Focused regressions for review findings B1–B7."""

from __future__ import annotations

from collections.abc import Mapping

import pytest

from routing import (
    Block,
    DriverIn,
    DriverPosition,
    EngineConfig,
    Lunch,
    OrderIn,
    Solution,
    SolutionStats,
    Stop,
    ValidationReport,
    online_insert,
    solve,
    validate,
)
from routing.consolidation import ConsolidationReport, consolidate
from routing.core import RouteState, build_sequential_route, try_append_trip
from routing.geo import AtyrauDistanceProvider
from routing.lunch import assign_lunch
from routing.minivans import try_build_run
from routing.pooling import pool_leftover_groups
from routing.rental import build_rental_routes


def order(order_id: str, t_min: int, seats: int = 1, lat: float = 47.1) -> OrderIn:
    return OrderIn(order_id, t_min, lat, 51.9, lat + 0.001, 51.901, seats, region="r")


def test_b1_capacity_checked_for_trip_and_run() -> None:
    """Old try_append_trip/try_build_run accepted units exceeding vehicle seats."""
    distance = AtyrauDistanceProvider()
    driver = DriverIn("d", "r", 4, 47.1, 51.9)
    too_large = order("large", 600, 5)
    fixed = EngineConfig()
    legacy = EngineConfig.legacy()
    assert try_append_trip(RouteState(driver), too_large, fixed, distance)[0] is None
    assert try_append_trip(RouteState(driver), too_large, legacy, distance)[0] is not None
    orders = {"a": order("a", 600, 3), "b": order("b", 602, 2)}
    assert try_build_run(RouteState(driver), orders, orders, fixed, distance) is None
    assert try_build_run(RouteState(driver), orders, orders, legacy, distance) is not None


def test_b2_group_pool_sorts_before_slice(monkeypatch: pytest.MonkeyPatch) -> None:
    """Old pool[:5] depended on source iteration and could discard nearest orders."""
    seed = order("seed", 590, lat=47.1)
    orders = {seed.id: seed}
    for index, delta in enumerate((0.040, 0.035, 0.030, 0.025, 0.020, 0.001)):
        item = order(f"c{index}", 600, lat=47.1 + delta)
        orders[item.id] = item
    base = order("base", 500)
    orders[base.id] = base
    stop = Stop("base", base.pickup_lat, base.pickup_lon, 500)
    block = Block("trip", ("base",), (stop,), (stop,), 500, 510)
    route = RouteState(DriverIn("d", "r", 4, 47.1, 51.9), [block])
    seen: list[tuple[str, ...]] = []

    def record(
        _route: RouteState,
        _position: int,
        group: tuple[str, ...],
        _orders: Mapping[str, OrderIn],
        _cfg: EngineConfig,
        _distance: object,
    ) -> bool:
        seen.append(group)
        return True

    monkeypatch.setattr("routing.pooling.try_insert_group_at_position", record)
    pool_leftover_groups(
        {"d": route}, set(orders) - {"base"}, orders, EngineConfig(), AtyrauDistanceProvider()
    )
    assert "c5" in seen[0]


def test_b3_lunch_includes_before_first_and_after_last_gaps() -> None:
    """Old lunch logic only inspected gaps between two trips."""
    item = order("a", 800)
    stop = Stop("a", item.pickup_lat, item.pickup_lon, 790)
    block = Block("trip", ("a",), (stop,), (stop,), 790, 810)
    route = RouteState(DriverIn("d", "r", 4, 47.1, 51.9), [block])
    assert assign_lunch(route, EngineConfig()) == Lunch(630.0, 750.0, True)
    legacy_route = RouteState(route.driver, [block])
    assert assign_lunch(legacy_route, EngineConfig.legacy()) is None


def test_b4_rentals_run_minimum_consolidation(monkeypatch: pytest.MonkeyPatch) -> None:
    """Old rental_min_orders was declared but consolidation was never called."""
    calls: list[int] = []

    def record(*args: object, **kwargs: object) -> ConsolidationReport:
        calls.append(int(kwargs["min_orders"]))
        return ConsolidationReport(())

    monkeypatch.setattr("routing.rental.consolidate", record)
    orders = {"a": order("a", 600)}
    build_rental_routes({"a"}, orders, EngineConfig(), AtyrauDistanceProvider())
    assert calls == [11]
    calls.clear()
    build_rental_routes({"a"}, orders, EngineConfig.legacy(), AtyrauDistanceProvider())
    assert calls == []


def test_b5_consolidation_returns_dissolved_driver_ids() -> None:
    """Old consolidate always returned an empty set even after a commit."""
    cfg = EngineConfig(min_orders=2, max_orders=3, n_rental=0)
    distance = AtyrauDistanceProvider()
    orders = {"a": order("a", 600), "b": order("b", 700)}
    first = RouteState(DriverIn("a-driver", "r", 4, 47.1, 51.9))
    second = RouteState(DriverIn("b-driver", "r", 4, 47.1, 51.9))
    assert build_sequential_route(first, ["a"], orders, cfg, distance)[0]
    assert build_sequential_route(second, ["b"], orders, cfg, distance)[0]
    routes = {"a-driver": first, "b-driver": second}
    report = consolidate(routes, orders, cfg, distance)
    assert report.dissolved_driver_ids


def test_b6_rebuild_respects_existing_lunch() -> None:
    """Old full rebuild silently placed a trip across route.lunch."""
    cfg = EngineConfig(n_rental=0)
    item = order("a", 660)
    route = RouteState(
        DriverIn("d", "r", 4, 47.1, 51.9), lunch=Lunch(650, 710, True)
    )
    assert not build_sequential_route(
        route, ["a"], {"a": item}, cfg, AtyrauDistanceProvider()
    )[0]


class SlowDistance:
    def distance_km(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        return abs(lat1 - lat2) * 100.0

    def time_minutes(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        return self.distance_km(lat1, lon1, lat2, lon2) * 3.0


def test_b7_online_idle_driver_uses_factual_position() -> None:
    """Old online insertion teleported an idle driver to the start of the window."""
    cfg = EngineConfig(n_rental=0, min_orders=1, distance_provider=SlowDistance())
    initial = solve([], [DriverIn("d", "r", 4, 47.1, 51.9)], cfg)
    result = online_insert(
        initial,
        order("new", 600, lat=47.1),
        {"d": DriverPosition(47.3, 51.9, 580)},
    )
    assert result.unassigned == {"new"}


def test_online_success_tuple_position_and_duplicate_rejected() -> None:
    cfg = EngineConfig(n_rental=0, min_orders=1)
    initial = solve([], [DriverIn("d", "r", 4, 47.1, 51.9)], cfg)
    result = online_insert(initial, order("new", 600), {"d": (47.1, 51.9)})
    assert not result.unassigned
    assert result.routes["d"][0].order_ids == ("new",)
    with pytest.raises(ValueError, match="already exists"):
        online_insert(result, order("new", 700), {"d": (47.1, 51.9, 0.0)})


def test_validator_reports_capacity_and_partition() -> None:
    item = order("large", 600, 5)
    stop = Stop(item.id, item.pickup_lat, item.pickup_lon, 600)
    block = Block("trip", (item.id,), (stop,), (stop,), 600, 610)
    solution = Solution(
        {"d": [block]},
        {},
        {item.id},
        ValidationReport(),
        SolutionStats(1, 1, 0, 1, 0),
        {item.id: item},
        {"d": DriverIn("d", "r", 4, 47.1, 51.9)},
        EngineConfig(),
    )
    report = validate(solution)
    assert report.count("capacity") == 1
    assert report.count("coverage") == 1


def test_validator_reports_duplicate_window_and_bbox() -> None:
    item = order("a", 600)
    bad = Stop(item.id, 39.0, 51.9, 700)
    block = Block("trip", (item.id,), (bad,), (bad,), 700, 710)
    solution = Solution(
        {"d": [block, block]},
        {},
        set(),
        ValidationReport(),
        SolutionStats(1, 1, 0, 1, 0),
        {item.id: item},
        {"d": DriverIn("d", "r", 4, 47.1, 51.9)},
        EngineConfig(),
    )
    report = validate(solution)
    assert report.count("duplicate") == 1
    assert report.count("time_window") == 2
    assert report.count("bbox") == 4
