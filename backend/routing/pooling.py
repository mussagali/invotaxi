"""Fallback pooling of leftover orders into or between existing blocks."""

from __future__ import annotations

import itertools
from collections.abc import Mapping

from routing.core import RouteState, try_append_trip
from routing.minivans import try_build_run
from routing.types import Block, DistanceProvider, EngineConfig, OrderIn


def _rebuild_tail(
    route: RouteState,
    prefix: list[Block],
    tail_ids: list[str],
    orders: Mapping[str, OrderIn],
    cfg: EngineConfig,
    distance: DistanceProvider,
) -> list[Block] | None:
    trial = RouteState(route.driver, list(prefix), route.lunch, route.is_rental)
    for order_id in tail_ids:
        block, _ = try_append_trip(trial, orders[order_id], cfg, distance)
        if block is None:
            return None
        trial.blocks.append(block)
    return trial.blocks


def try_pool_order_into_route(
    route: RouteState,
    position: int,
    new_order_id: str,
    orders: Mapping[str, OrderIn],
    cfg: EngineConfig,
    distance: DistanceProvider,
) -> bool:
    old = route.blocks[position]
    existing_seats = sum(orders[item].seats for item in old.order_ids)
    if existing_seats + orders[new_order_id].seats > route.driver.capacity:
        return False
    if route.driver.capacity >= 6 and len(old.order_ids) >= cfg.minivan_run_size:
        return False
    group = (*old.order_ids, new_order_id)
    trial = RouteState(
        route.driver, list(route.blocks[:position]), route.lunch, route.is_rental
    )
    run = try_build_run(trial, group, orders, cfg, distance)
    if run is None:
        return False
    tail = [item for block in route.blocks[position + 1 :] for item in block.order_ids]
    rebuilt = _rebuild_tail(route, [*route.blocks[:position], run], tail, orders, cfg, distance)
    if rebuilt is None:
        return False
    route.blocks = rebuilt
    return True


def try_insert_group_at_position(
    route: RouteState,
    position: int,
    group: tuple[str, ...],
    orders: Mapping[str, OrderIn],
    cfg: EngineConfig,
    distance: DistanceProvider,
) -> bool:
    if sum(orders[item].seats for item in group) > route.driver.capacity:
        return False
    trial = RouteState(
        route.driver, list(route.blocks[:position]), route.lunch, route.is_rental
    )
    run = try_build_run(trial, group, orders, cfg, distance)
    if run is None:
        return False
    tail = [item for block in route.blocks[position:] for item in block.order_ids]
    rebuilt = _rebuild_tail(route, [*route.blocks[:position], run], tail, orders, cfg, distance)
    if rebuilt is None:
        return False
    route.blocks = rebuilt
    return True


def pool_leftovers(
    routes: Mapping[str, RouteState],
    leftovers: set[str],
    orders: Mapping[str, OrderIn],
    cfg: EngineConfig,
    distance: DistanceProvider,
    max_orders: int | None = None,
) -> set[str]:
    limit = cfg.max_orders if max_orders is None else max_orders
    still: set[str] = set()
    for order_id in sorted(leftovers, key=lambda item: (orders[item].t_min, item)):
        order = orders[order_id]
        candidates: list[tuple[int, float, str, int, RouteState]] = []
        for driver_id, route in sorted(routes.items()):
            if (
                route.driver.capacity >= 6
                or route.n_orders() == 0
                or route.n_orders() >= limit
            ):
                continue
            for position, block in enumerate(route.blocks):
                time_diff = min(abs(order.t_min - orders[item].t_min) for item in block.order_ids)
                if time_diff > cfg.pool_max_time_diff:
                    continue
                first = block.pickup_seq[0]
                dist = distance.distance_km(
                    first.lat, first.lon, order.pickup_lat, order.pickup_lon
                )
                if dist <= cfg.pool_max_km:
                    candidates.append((time_diff, dist, driver_id, position, route))
        candidates.sort(key=lambda item: (item[0], item[1], item[2], item[3]))
        placed = any(
            try_pool_order_into_route(route, position, order_id, orders, cfg, distance)
            for _, _, _, position, route in candidates
        )
        if not placed:
            still.add(order_id)
    return still


def pool_leftover_groups(
    routes: Mapping[str, RouteState],
    leftovers: set[str],
    orders: Mapping[str, OrderIn],
    cfg: EngineConfig,
    distance: DistanceProvider,
    max_orders: int | None = None,
) -> set[str]:
    """Group leftovers, with B2 distance ordering before taking five candidates."""
    limit = cfg.max_orders if max_orders is None else max_orders
    remaining = set(leftovers)
    changed = True
    while changed:
        changed = False
        for seed in sorted(remaining, key=lambda item: (orders[item].t_min, item)):
            seed_order = orders[seed]
            nearby: list[tuple[float, str]] = []
            for candidate in sorted(remaining):
                if candidate == seed:
                    continue
                order = orders[candidate]
                if abs(order.t_min - seed_order.t_min) > 45:
                    continue
                dist = distance.distance_km(
                    seed_order.pickup_lat,
                    seed_order.pickup_lon,
                    order.pickup_lat,
                    order.pickup_lon,
                )
                if dist <= 8:
                    nearby.append((dist, candidate))
            if cfg.sort_group_pool_by_distance:
                nearby.sort(key=lambda item: (item[0], item[1]))
            pool = [item[1] for item in nearby[:5]]
            placed = False
            for size in (4, 3, 2):
                if size - 1 > len(pool):
                    continue
                for extra in itertools.combinations(pool, size - 1):
                    group = (seed, *extra)
                    seats = sum(orders[item].seats for item in group)
                    for _, route in sorted(routes.items()):
                        if (
                            route.driver.capacity >= 6
                            or seats > route.driver.capacity
                            or route.n_orders() == 0
                            or route.n_orders() + size > limit
                        ):
                            continue
                        for position in range(len(route.blocks) + 1):
                            if try_insert_group_at_position(
                                route, position, group, orders, cfg, distance
                            ):
                                remaining.difference_update(group)
                                placed = changed = True
                                break
                        if placed:
                            break
                    if placed:
                        break
                if placed:
                    break
            if placed:
                break
    return remaining
