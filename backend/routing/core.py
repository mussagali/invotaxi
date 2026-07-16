"""Sequential route construction and radius-escalating greedy insertion."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

from routing.types import Block, DistanceProvider, DriverIn, EngineConfig, Lunch, OrderIn, Stop


@dataclass(slots=True)
class RouteState:
    driver: DriverIn
    blocks: list[Block] = field(default_factory=list)
    lunch: Lunch | None = None
    is_rental: bool = False

    def order_ids(self) -> list[str]:
        return [order_id for block in self.blocks for order_id in block.order_ids]

    def n_orders(self) -> int:
        return sum(len(block.order_ids) for block in self.blocks)

    def last_position(self) -> tuple[float, float]:
        if not self.blocks:
            return self.driver.start_lat, self.driver.start_lon
        stop = self.blocks[-1].dropoff_seq[-1]
        return stop.lat, stop.lon

    def last_time(self) -> float | None:
        return self.blocks[-1].end_time if self.blocks else None

    def light_copy(self) -> RouteState:
        return RouteState(self.driver, list(self.blocks), self.lunch, self.is_rental)


def _overlaps_lunch(start: float, end: float, lunch: Lunch | None) -> bool:
    return lunch is not None and start < lunch.end_min and end > lunch.start_min


def try_append_trip(
    route: RouteState,
    order: OrderIn,
    cfg: EngineConfig,
    distance: DistanceProvider,
    *,
    initial_available_at: float | None = None,
) -> tuple[Block | None, float]:
    """Try the legacy pickup→dropoff block, with B1/B6 checks."""
    pos_lat, pos_lon = route.last_position()
    free_time = route.last_time()
    distance_to_pickup = distance.distance_km(
        pos_lat, pos_lon, order.pickup_lat, order.pickup_lon
    )
    travel_to_pickup = distance.time_minutes(
        pos_lat, pos_lon, order.pickup_lat, order.pickup_lon
    )
    if cfg.enforce_capacity and order.seats > route.driver.capacity:
        return None, distance_to_pickup

    if free_time is None and initial_available_at is None:
        earliest_arrival = float(order.t_min - cfg.time_window_slack)
    else:
        available = free_time if free_time is not None else float(initial_available_at or 0.0)
        if route.lunch is not None and available < route.lunch.end_min:
            leave_at = (
                route.lunch.end_min
                if available >= route.lunch.start_min
                else available
            )
        else:
            leave_at = available
        earliest_arrival = leave_at + travel_to_pickup

    pickup = max(earliest_arrival, float(order.t_min - cfg.time_window_slack))
    travel_order = distance.time_minutes(
        order.pickup_lat,
        order.pickup_lon,
        order.dropoff_lat,
        order.dropoff_lon,
    )
    end = pickup + cfg.service_time_min + travel_order + cfg.service_time_min

    if _overlaps_lunch(pickup, end, route.lunch):
        assert route.lunch is not None
        pickup = max(
            route.lunch.end_min + travel_to_pickup,
            float(order.t_min - cfg.time_window_slack),
        )
        end = pickup + cfg.service_time_min + travel_order + cfg.service_time_min

    if pickup > order.t_min + cfg.time_window_slack:
        return None, distance_to_pickup
    pickup_stop = Stop(order.id, order.pickup_lat, order.pickup_lon, pickup)
    dropoff_stop = Stop(order.id, order.dropoff_lat, order.dropoff_lon, end)
    return (
        Block("trip", (order.id,), (pickup_stop,), (dropoff_stop,), pickup, end),
        distance_to_pickup,
    )


def build_sequential_route(
    route: RouteState,
    order_ids: Iterable[str],
    orders: Mapping[str, OrderIn],
    cfg: EngineConfig,
    distance: DistanceProvider,
    *,
    preserve_order: bool = False,
    initial_available_at: float | None = None,
) -> tuple[bool, list[str]]:
    """Fully rebuild a candidate route, preserving an already assigned lunch."""
    ids = list(order_ids)
    if not preserve_order:
        ids.sort(key=lambda order_id: (orders[order_id].t_min, order_id))
    route.blocks = []
    failed: list[str] = []
    for order_id in ids:
        block, _ = try_append_trip(
            route,
            orders[order_id],
            cfg,
            distance,
            initial_available_at=initial_available_at,
        )
        if block is None:
            failed.append(order_id)
        else:
            route.blocks.append(block)
    return not failed, failed


def find_driver_for_order(
    order: OrderIn,
    active: list[RouteState],
    unused: list[RouteState],
    orders: Mapping[str, OrderIn],
    cfg: EngineConfig,
    distance: DistanceProvider,
    max_orders: int | None = None,
) -> tuple[RouteState | None, bool]:
    """Apply the original 2→5→10→∞ search with full candidate rebuilds."""
    limit = cfg.max_orders if max_orders is None else max_orders
    for radius in cfg.radii_km:
        candidates: list[tuple[float, str, RouteState, list[Block]]] = []
        for route in sorted(active, key=lambda item: item.driver.id):
            if route.n_orders() >= limit:
                continue
            lat, lon = route.last_position()
            dist = distance.distance_km(lat, lon, order.pickup_lat, order.pickup_lon)
            if dist > radius:
                continue
            trial = RouteState(route.driver, lunch=route.lunch, is_rental=route.is_rental)
            ok, _ = build_sequential_route(
                trial, route.order_ids() + [order.id], orders, cfg, distance
            )
            if ok:
                candidates.append((dist, route.driver.id, route, trial.blocks))
        if candidates:
            _, _, selected, blocks = min(candidates, key=lambda item: (item[0], item[1]))
            selected.blocks = blocks
            return selected, False

        fresh: list[tuple[float, str, RouteState, list[Block]]] = []
        for route in sorted(unused, key=lambda item: item.driver.id):
            dist = distance.distance_km(
                route.driver.start_lat,
                route.driver.start_lon,
                order.pickup_lat,
                order.pickup_lon,
            )
            if dist > radius:
                continue
            trial = RouteState(route.driver, lunch=route.lunch, is_rental=route.is_rental)
            ok, _ = build_sequential_route(trial, [order.id], orders, cfg, distance)
            if ok:
                fresh.append((dist, route.driver.id, route, trial.blocks))
        if fresh:
            _, _, selected, blocks = min(fresh, key=lambda item: (item[0], item[1]))
            selected.blocks = blocks
            return selected, True
    return None, False
