"""Minivan run construction using exhaustive pickup/dropoff permutations."""

from __future__ import annotations

import itertools
from collections.abc import Iterable, Mapping, Sequence

from routing.core import RouteState
from routing.geo import bearing_degrees, bearing_difference
from routing.types import Block, DistanceProvider, EngineConfig, OrderIn, Stop


def _in_peak_window(t_min: int, cfg: EngineConfig) -> bool:
    return any(start <= t_min <= end for start, end in cfg.minivan_peak_windows)


def _is_long_haul(
    order: OrderIn, cfg: EngineConfig, distance: DistanceProvider
) -> bool:
    return (
        distance.distance_km(
            order.pickup_lat,
            order.pickup_lon,
            order.dropoff_lat,
            order.dropoff_lon,
        )
        >= cfg.minivan_long_haul_km
    )


def minivan_group_is_valid(
    group: Iterable[str],
    orders: Mapping[str, OrderIn],
    cfg: EngineConfig,
    distance: DistanceProvider,
) -> bool:
    """Apply the strict grouping contract from the supplied routing toolkit."""
    order_ids = tuple(group)
    if not 2 <= len(order_ids) <= cfg.minivan_run_size:
        return False
    selected = [orders[order_id] for order_id in order_ids]
    if any(not _in_peak_window(order.t_min, cfg) for order in selected):
        return False
    times = [order.t_min for order in selected]
    if max(times) - min(times) > cfg.minivan_time_cluster_min:
        return False
    if any(
        distance.distance_km(
            first.pickup_lat,
            first.pickup_lon,
            second.pickup_lat,
            second.pickup_lon,
        )
        > cfg.minivan_pickup_proximity_km
        for first, second in itertools.combinations(selected, 2)
    ):
        return False
    if any(not _is_long_haul(order, cfg, distance) for order in selected):
        return False
    pickup_lat = sum(order.pickup_lat for order in selected) / len(selected)
    pickup_lon = sum(order.pickup_lon for order in selected) / len(selected)
    bearings = [
        bearing_degrees(pickup_lat, pickup_lon, order.dropoff_lat, order.dropoff_lon)
        for order in selected
    ]
    return all(
        bearing_difference(first, second) <= cfg.minivan_dropoff_direction_deg
        for first, second in itertools.combinations(bearings, 2)
    )


def _walk_sequence(
    points: Sequence[tuple[str, float, float]],
    start_lat: float,
    start_lon: float,
    start_time: float | None,
    pickup: bool,
    orders: Mapping[str, OrderIn],
    cfg: EngineConfig,
    distance: DistanceProvider,
) -> tuple[tuple[Stop, ...], float, float, float] | None:
    current_lat, current_lon, current_time = start_lat, start_lon, start_time
    stops: list[Stop] = []
    for order_id, lat, lon in points:
        if current_time is None:
            arrival = float(orders[order_id].t_min - cfg.time_window_slack) if pickup else 0.0
        else:
            arrival = current_time + distance.time_minutes(current_lat, current_lon, lat, lon)
        if pickup:
            target = orders[order_id].t_min
            actual = max(arrival, float(target - cfg.time_window_slack))
            if actual > target + cfg.time_window_slack:
                return None
            next_time = actual + cfg.service_time_min
            stops.append(Stop(order_id, lat, lon, actual))
        else:
            next_time = arrival + cfg.service_time_min
            stops.append(Stop(order_id, lat, lon, next_time))
        current_lat, current_lon, current_time = lat, lon, next_time
    assert current_time is not None
    return tuple(stops), current_lat, current_lon, current_time


def try_build_run(
    route: RouteState,
    order_group: Iterable[str],
    orders: Mapping[str, OrderIn],
    cfg: EngineConfig,
    distance: DistanceProvider,
) -> Block | None:
    """Build an all-pickups-then-all-dropoffs run (B1 capacity-aware)."""
    group = tuple(order_group)
    if cfg.enforce_capacity and sum(orders[item].seats for item in group) > route.driver.capacity:
        return None
    if route.driver.capacity >= 6 and not minivan_group_is_valid(
        group, orders, cfg, distance
    ):
        return None
    start_lat, start_lon = route.last_position()
    free_time = route.last_time()
    pickup_points = tuple(
        (item, orders[item].pickup_lat, orders[item].pickup_lon) for item in group
    )
    pickup_options: list[tuple[float, tuple[Stop, ...], float, float, float]] = []
    for permutation in itertools.permutations(pickup_points):
        walked = _walk_sequence(
            permutation, start_lat, start_lon, free_time, True, orders, cfg, distance
        )
        if walked is None:
            continue
        sequence, lat, lon, end_time = walked
        cost = sum(abs(stop.time - orders[stop.order_id].t_min) for stop in sequence)
        pickup_options.append((cost, sequence, lat, lon, end_time))
    if not pickup_options:
        return None
    _, pickup_seq, lat, lon, pickup_end = min(
        pickup_options,
        key=lambda item: (item[0], tuple(stop.order_id for stop in item[1])),
    )
    dropoff_points = tuple(
        (item, orders[item].dropoff_lat, orders[item].dropoff_lon) for item in group
    )
    dropoff_options: list[tuple[float, tuple[Stop, ...]]] = []
    for permutation in itertools.permutations(dropoff_points):
        walked = _walk_sequence(
            permutation, lat, lon, pickup_end, False, orders, cfg, distance
        )
        if walked is not None:
            sequence, _, _, end_time = walked
            dropoff_options.append((end_time, sequence))
    if not dropoff_options:
        return None
    end_time, dropoff_seq = min(
        dropoff_options,
        key=lambda item: (item[0], tuple(stop.order_id for stop in item[1])),
    )
    block = Block(
        "run", group, pickup_seq, dropoff_seq, pickup_seq[0].time, end_time
    )
    if (
        route.lunch is not None
        and block.start_time < route.lunch.end_min
        and block.end_time > route.lunch.start_min
    ):
        return None
    return block


def build_minivan_runs(
    route: RouteState,
    unassigned: set[str],
    orders: Mapping[str, OrderIn],
    cfg: EngineConfig,
    distance: DistanceProvider,
) -> set[str]:
    assigned: set[str] = set()
    remaining = {
        order_id
        for order_id in unassigned
        if _in_peak_window(orders[order_id].t_min, cfg)
        and _is_long_haul(orders[order_id], cfg, distance)
    }
    for window_start, window_end in cfg.minivan_peak_windows:
        window_pool = sorted(
            (
                order_id
                for order_id in remaining
                if window_start <= orders[order_id].t_min <= window_end
            ),
            key=lambda item: (orders[item].t_min, item),
        )
        while window_pool and route.n_orders() < cfg.max_orders:
            seed = window_pool[0]
            seed_order = orders[seed]
            candidates = [
                order_id
                for order_id in window_pool[1:]
                if abs(orders[order_id].t_min - seed_order.t_min)
                <= cfg.minivan_time_cluster_min
                and distance.distance_km(
                    seed_order.pickup_lat,
                    seed_order.pickup_lon,
                    orders[order_id].pickup_lat,
                    orders[order_id].pickup_lon,
                )
                <= cfg.minivan_pickup_proximity_km
            ]
            room = cfg.max_orders - route.n_orders()
            chosen: tuple[Block, tuple[str, ...]] | None = None
            for size in range(min(cfg.minivan_run_size, room), 1, -1):
                for extra in itertools.combinations(candidates, size - 1):
                    group = (seed, *extra)
                    block = try_build_run(route, group, orders, cfg, distance)
                    if block is not None:
                        chosen = block, group
                        break
                if chosen is not None:
                    break
            if chosen is None:
                window_pool.remove(seed)
                remaining.discard(seed)
                continue
            block, group = chosen
            route.blocks.append(block)
            for item in group:
                assigned.add(item)
                remaining.discard(item)
                window_pool.remove(item)
    return assigned
