"""Compare fixed and deterministic legacy-mode routing on the golden 250 set."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> None:
    from tests.routing.data import generate_dataset

    from routing import EngineConfig, solve

    orders, drivers = generate_dataset(250, seed=42)
    modes = (
        ("с фиксами", EngineConfig(min_orders=3, rental_min_orders=3)),
        ("legacy B1-B4 off", EngineConfig.legacy()),
    )
    results = []
    solutions = {}
    for label, config in modes:
        if label.startswith("legacy"):
            config.min_orders = 3
            config.rental_min_orders = 3
        solution = solve(orders, drivers, config)
        solutions[label] = solution
        results.append(
            (
                label,
                solution.stats.assigned_orders,
                solution.stats.unassigned_orders,
                len(solution.validation.issues),
            )
        )
    print("Режим             | Размещено | Не размещено | Нарушения validate()")
    print("------------------|-----------:|-------------:|----------------------:")
    for label, assigned, unassigned, violations in results:
        print(f"{label:<18}| {assigned:>10} | {unassigned:>12} | {violations:>21}")

    fixed = solutions["с фиксами"]
    legacy = solutions["legacy B1-B4 off"]
    overloaded_orders: set[str] = set()
    overloaded_blocks = 0
    for driver_id, blocks in legacy.routes.items():
        capacity = legacy._drivers[driver_id].capacity
        for block in blocks:
            seats = sum(legacy._orders[order_id].seats for order_id in block.order_ids)
            if seats > capacity:
                overloaded_blocks += 1
                overloaded_orders.update(block.order_ids)
    twin_unassigned = {
        order_id for order_id in fixed.unassigned if fixed._orders[order_id].twin_size > 1
    }
    print()
    print(
        "Legacy: "
        f"{overloaded_blocks} переполненных блоков, "
        f"число заказов в них — {len(overloaded_orders)}: "
        f"{', '.join(sorted(overloaded_orders))}."
    )
    print(
        "С фиксами: "
        f"{len(fixed.unassigned)} неразмещённых юнита: "
        f"{', '.join(sorted(fixed.unassigned))}; "
        f"число twin/triplet среди них — {len(twin_unassigned)}."
    )


if __name__ == "__main__":
    main()
