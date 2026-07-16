"""Virtual rental vehicles for leftovers across all regions."""

from __future__ import annotations

from collections.abc import Mapping

from routing.consolidation import ConsolidationReport, consolidate
from routing.core import RouteState, find_driver_for_order
from routing.pooling import pool_leftover_groups, pool_leftovers
from routing.types import DistanceProvider, DriverIn, EngineConfig, OrderIn


def build_rental_routes(
    leftovers: set[str],
    orders: Mapping[str, OrderIn],
    cfg: EngineConfig,
    distance: DistanceProvider,
    reserved_driver_ids: set[str] | None = None,
) -> tuple[dict[str, RouteState], set[str], ConsolidationReport]:
    if not leftovers or cfg.n_rental <= 0:
        return {}, set(leftovers), ConsolidationReport(())
    ordered_leftovers = sorted(leftovers)
    center_lat = sum(orders[item].pickup_lat for item in ordered_leftovers) / len(leftovers)
    center_lon = sum(orders[item].pickup_lon for item in ordered_leftovers) / len(leftovers)
    routes: dict[str, RouteState] = {}
    reserved = set() if reserved_driver_ids is None else reserved_driver_ids
    suffix = 1
    for _ in range(cfg.n_rental):
        driver_id = f"RENT{suffix}"
        while driver_id in reserved or driver_id in routes:
            suffix += 1
            driver_id = f"RENT{suffix}"
        suffix += 1
        driver = DriverIn(driver_id, "rental", 4, center_lat, center_lon)
        routes[driver_id] = RouteState(driver, is_rental=True)
    unused = [route for _, route in sorted(routes.items())]
    active: list[RouteState] = []
    still: set[str] = set()
    limit = cfg.max_orders * 3
    for order_id in sorted(leftovers, key=lambda item: (orders[item].t_min, item)):
        selected, is_new = find_driver_for_order(
            orders[order_id], active, unused, orders, cfg, distance, limit
        )
        if selected is None:
            still.add(order_id)
        elif is_new:
            unused.remove(selected)
            active.append(selected)
    still = pool_leftovers(routes, still, orders, cfg, distance, limit)
    if still:
        still = pool_leftover_groups(routes, still, orders, cfg, distance, limit)
    report = ConsolidationReport(())
    if cfg.consolidate_rentals:
        report = consolidate(
            routes,
            orders,
            cfg,
            distance,
            min_orders=cfg.rental_min_orders,
            max_orders=limit,
        )
    return routes, still, report
