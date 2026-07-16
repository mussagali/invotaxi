"""Incremental insertion into an existing solution."""

from __future__ import annotations

from collections.abc import Mapping

from routing.core import RouteState, build_sequential_route
from routing.geo import AtyrauDistanceProvider
from routing.types import (
    Block,
    DriverIn,
    DriverPosition,
    OrderIn,
    Solution,
    SolutionStats,
)
from routing.validate import validate_components

PositionValue = DriverPosition | tuple[float, float] | tuple[float, float, float]


def _position(value: PositionValue) -> DriverPosition:
    if isinstance(value, DriverPosition):
        return value
    if len(value) == 2:
        return DriverPosition(value[0], value[1])
    return DriverPosition(value[0], value[1], value[2])


def online_insert(
    solution: Solution,
    new_order: OrderIn,
    driver_positions: Mapping[str, PositionValue],
) -> Solution:
    """Insert one order; an idle driver must drive from its factual position (B7)."""
    if new_order.id in solution._orders:
        raise ValueError(f"order {new_order.id} already exists")
    cfg = solution._config
    distance = cfg.distance_provider or AtyrauDistanceProvider(
        cfg.avg_speed_kmh, cfg.winding
    )
    orders = {**solution._orders, new_order.id: new_order}
    new_routes = {driver_id: list(blocks) for driver_id, blocks in solution.routes.items()}
    candidates: list[tuple[float, str, list[Block]]] = []
    for driver_id, driver in sorted(solution._drivers.items()):
        if (
            driver.region != new_order.region
            or driver.capacity >= 6
            or driver_id.startswith("RENT")
        ):
            continue
        existing = new_routes.get(driver_id, [])
        if sum(len(block.order_ids) for block in existing) >= cfg.max_orders:
            continue
        lunch = solution.lunches.get(driver_id)
        if existing:
            trial_driver = driver
            initial_available_at = None
        else:
            factual = _position(driver_positions.get(
                driver_id,
                DriverPosition(driver.start_lat, driver.start_lon),
            ))
            trial_driver = DriverIn(
                driver.id, driver.region, driver.capacity, factual.lat, factual.lon
            )
            initial_available_at = factual.available_at
        route = RouteState(trial_driver, lunch=lunch)
        existing_ids = [item for block in existing for item in block.order_ids]
        ok, _ = build_sequential_route(
            route,
            [*existing_ids, new_order.id],
            orders,
            cfg,
            distance,
            initial_available_at=initial_available_at,
        )
        if ok:
            if existing:
                last = existing[-1].dropoff_seq[-1]
                dist = distance.distance_km(
                    last.lat, last.lon, new_order.pickup_lat, new_order.pickup_lon
                )
            else:
                dist = distance.distance_km(
                    trial_driver.start_lat,
                    trial_driver.start_lon,
                    new_order.pickup_lat,
                    new_order.pickup_lon,
                )
            candidates.append((dist, driver_id, route.blocks))
    unassigned = set(solution.unassigned)
    if candidates:
        _, selected_id, blocks = min(candidates, key=lambda item: (item[0], item[1]))
        new_routes[selected_id] = blocks
    else:
        unassigned.add(new_order.id)
    assigned = len(orders) - len(unassigned)
    stats = SolutionStats(
        len(orders),
        assigned,
        len(unassigned),
        sum(bool(blocks) for blocks in new_routes.values()),
        solution.stats.rental_drivers,
        solution.stats.dissolved_drivers,
    )
    report = validate_components(
        new_routes,
        unassigned,
        orders,
        solution._drivers,
        cfg.time_window_slack,
    )
    return Solution(
        new_routes,
        dict(solution.lunches),
        unassigned,
        report,
        stats,
        orders,
        dict(solution._drivers),
        cfg,
    )
