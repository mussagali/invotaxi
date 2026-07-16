"""Transactional dissolution of underfilled driver routes."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from routing.core import RouteState, find_driver_for_order
from routing.types import DistanceProvider, EngineConfig, OrderIn


@dataclass(frozen=True, slots=True)
class ConsolidationReport:
    dissolved_driver_ids: tuple[str, ...]


def consolidate(
    routes: dict[str, RouteState],
    orders: Mapping[str, OrderIn],
    cfg: EngineConfig,
    distance: DistanceProvider,
    *,
    min_orders: int | None = None,
    max_orders: int | None = None,
) -> ConsolidationReport:
    """Commit a victim dissolution only when every orphan is placed (B5)."""
    minimum = cfg.min_orders if min_orders is None else min_orders
    maximum = cfg.max_orders if max_orders is None else max_orders
    tried: set[str] = set()
    dissolved: list[str] = []
    for _ in range(60):
        active = [
            route
            for route in routes.values()
            if route.n_orders() > 0 and route.driver.capacity < 6
        ]
        if len(active) <= 1:
            break
        underfilled = [
            route
            for route in active
            if route.n_orders() < minimum and route.driver.id not in tried
        ]
        if not underfilled:
            break
        victim = min(underfilled, key=lambda route: (route.n_orders(), route.driver.id))
        tried.add(victim.driver.id)
        trials = {driver_id: route.light_copy() for driver_id, route in routes.items()}
        trials[victim.driver.id].blocks = []
        trials[victim.driver.id].lunch = None
        remaining_active = [
            route
            for driver_id, route in sorted(trials.items())
            if driver_id != victim.driver.id
            and route.n_orders() > 0
            and route.driver.capacity < 6
        ]
        unused = [
            route
            for driver_id, route in sorted(trials.items())
            if driver_id != victim.driver.id
            and route.n_orders() == 0
            and route.driver.capacity < 6
        ]
        success = True
        for order_id in sorted(
            victim.order_ids(), key=lambda item: (orders[item].t_min, item)
        ):
            selected, is_new = find_driver_for_order(
                orders[order_id],
                remaining_active,
                unused,
                orders,
                cfg,
                distance,
                maximum,
            )
            if selected is None:
                success = False
                break
            if is_new:
                unused.remove(selected)
                remaining_active.append(selected)
        if success:
            routes.clear()
            routes.update(trials)
            dissolved.append(victim.driver.id)
    return ConsolidationReport(tuple(dissolved))
