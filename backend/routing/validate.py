"""Independent validation gate for routing solutions."""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence

from routing.geo import in_bbox
from routing.types import Block, DriverIn, OrderIn, Solution, ValidationIssue, ValidationReport


def validate_components(
    routes: Mapping[str, Sequence[Block]],
    unassigned: set[str],
    orders: Mapping[str, OrderIn],
    drivers: Mapping[str, DriverIn],
    slack: int,
) -> ValidationReport:
    used = [
        order_id
        for blocks in routes.values()
        for block in blocks
        for order_id in block.order_ids
    ]
    issues: list[ValidationIssue] = []
    for order_id, count in sorted(Counter(used).items()):
        if count > 1:
            issues.append(
                ValidationIssue(
                    "duplicate",
                    f"order {order_id} is assigned {count} times",
                    order_id=order_id,
                )
            )
    for driver_id, blocks in sorted(routes.items()):
        driver = drivers.get(driver_id)
        if driver is None:
            continue
        for block in blocks:
            seats = sum(orders[item].seats for item in block.order_ids if item in orders)
            if seats > driver.capacity:
                issues.append(
                    ValidationIssue(
                        "capacity",
                        f"block needs {seats} seats but capacity is {driver.capacity}",
                        driver_id,
                    )
                )
            for stop in block.pickup_seq:
                order = orders.get(stop.order_id)
                if order is not None and abs(stop.time - order.t_min) > slack + 1e-9:
                    issues.append(
                        ValidationIssue(
                            "time_window",
                            f"pickup {stop.time:.2f} is outside target {order.t_min}±{slack}",
                            driver_id,
                            stop.order_id,
                        )
                    )
            for stop in (*block.pickup_seq, *block.dropoff_seq):
                if not in_bbox(stop.lat, stop.lon):
                    issues.append(
                        ValidationIssue(
                            "bbox",
                            f"coordinate ({stop.lat}, {stop.lon}) is outside Atyrau bbox",
                            driver_id,
                            stop.order_id,
                        )
                    )
    assigned = set(used)
    expected = set(orders)
    if assigned & unassigned or assigned | unassigned != expected:
        issues.append(
            ValidationIssue(
                "coverage",
                "assigned and unassigned orders do not form an exact partition",
            )
        )
    return ValidationReport(tuple(issues))


def validate(solution: Solution) -> ValidationReport:
    """Revalidate a solution using the immutable inputs retained by solve()."""
    return validate_components(
        solution.routes,
        solution.unassigned,
        solution._orders,
        solution._drivers,
        solution._config.time_window_slack,
    )
