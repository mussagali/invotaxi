"""Top-level deterministic staged solver."""

from __future__ import annotations

from collections import defaultdict

from routing.consolidation import consolidate
from routing.core import RouteState, find_driver_for_order
from routing.geo import AtyrauDistanceProvider
from routing.lunch import assign_lunch
from routing.minivans import build_minivan_runs
from routing.pooling import pool_leftover_groups, pool_leftovers
from routing.rental import build_rental_routes
from routing.types import (
    DistanceProvider,
    DriverIn,
    EngineConfig,
    OrderIn,
    Solution,
    SolutionStats,
)
from routing.validate import validate_components


def _build_region(
    region_orders: dict[str, OrderIn],
    region_drivers: list[DriverIn],
    cfg: EngineConfig,
    distance: DistanceProvider,
) -> tuple[dict[str, RouteState], set[str], list[str]]:
    routes = {
        driver.id: RouteState(driver)
        for driver in sorted(region_drivers, key=lambda item: item.id)
    }
    unassigned = set(region_orders)
    for _, route in sorted(routes.items()):
        if route.driver.capacity >= 6:
            unassigned -= build_minivan_runs(
                route, unassigned, region_orders, cfg, distance
            )
    regular = [
        route for _, route in sorted(routes.items()) if route.driver.capacity < 6
    ]
    active: list[RouteState] = []
    unused = list(regular)
    leftovers: set[str] = set()
    for order_id in sorted(unassigned, key=lambda item: (region_orders[item].t_min, item)):
        selected, is_new = find_driver_for_order(
            region_orders[order_id], active, unused, region_orders, cfg, distance
        )
        if selected is None:
            leftovers.add(order_id)
        else:
            unassigned.discard(order_id)
            if is_new:
                unused.remove(selected)
                active.append(selected)
    dissolved: list[str] = []
    for _ in range(4):
        report = consolidate(routes, region_orders, cfg, distance)
        dissolved.extend(report.dissolved_driver_ids)
        active = [
            route
            for _, route in sorted(routes.items())
            if route.n_orders() > 0 and route.driver.capacity < 6
        ]
        unused = [
            route
            for _, route in sorted(routes.items())
            if route.n_orders() == 0 and route.driver.capacity < 6
        ]
        still: set[str] = set()
        for order_id in sorted(leftovers, key=lambda item: (region_orders[item].t_min, item)):
            selected, is_new = find_driver_for_order(
                region_orders[order_id], active, unused, region_orders, cfg, distance
            )
            if selected is None:
                still.add(order_id)
            elif is_new:
                unused.remove(selected)
                active.append(selected)
        leftovers = pool_leftovers(routes, still, region_orders, cfg, distance)
        if leftovers:
            leftovers = pool_leftover_groups(routes, leftovers, region_orders, cfg, distance)
        if not leftovers:
            break
    return routes, leftovers, dissolved


def solve(orders: list[OrderIn], drivers: list[DriverIn], cfg: EngineConfig) -> Solution:
    """Run minivans→sedans→four fallback rounds→rentals→lunch→validation."""
    order_map = {order.id: order for order in orders}
    driver_map = {driver.id: driver for driver in drivers}
    if len(order_map) != len(orders):
        raise ValueError("order ids must be unique")
    if len(driver_map) != len(drivers):
        raise ValueError("driver ids must be unique")
    distance = cfg.distance_provider or AtyrauDistanceProvider(
        cfg.avg_speed_kmh, cfg.winding
    )
    by_region_orders: defaultdict[str, dict[str, OrderIn]] = defaultdict(dict)
    by_region_drivers: defaultdict[str, list[DriverIn]] = defaultdict(list)
    for order in orders:
        by_region_orders[order.region][order.id] = order
    for driver in drivers:
        by_region_drivers[driver.region].append(driver)
    states: dict[str, RouteState] = {}
    leftovers: set[str] = set()
    dissolved: list[str] = []
    for region in sorted(set(by_region_orders) | set(by_region_drivers)):
        region_routes, region_leftovers, region_dissolved = _build_region(
            by_region_orders[region], by_region_drivers[region], cfg, distance
        )
        states.update(region_routes)
        leftovers.update(region_leftovers)
        dissolved.extend(region_dissolved)
    rentals, leftovers, rental_report = build_rental_routes(
        leftovers, order_map, cfg, distance, set(driver_map)
    )
    states.update(rentals)
    dissolved.extend(rental_report.dissolved_driver_ids)
    lunches = {}
    for driver_id, route in sorted(states.items()):
        lunch = assign_lunch(route, cfg)
        if lunch is not None:
            lunches[driver_id] = lunch
    public_routes = {
        driver_id: list(route.blocks) for driver_id, route in sorted(states.items())
    }
    all_drivers = {**driver_map, **{item: route.driver for item, route in rentals.items()}}
    report = validate_components(
        public_routes, leftovers, order_map, all_drivers, cfg.time_window_slack
    )
    assigned_count = len(orders) - len(leftovers)
    stats = SolutionStats(
        len(orders),
        assigned_count,
        len(leftovers),
        sum(bool(blocks) for blocks in public_routes.values()),
        sum(bool(route.blocks) for route in rentals.values()),
        tuple(dissolved),
    )
    return Solution(
        public_routes,
        lunches,
        leftovers,
        report,
        stats,
        order_map,
        all_drivers,
        cfg,
    )
