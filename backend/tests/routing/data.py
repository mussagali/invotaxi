"""Deterministic synthetic data shared by golden tests and comparison script."""

from __future__ import annotations

import random

from routing import DriverIn, OrderIn


def generate_dataset(
    n_orders: int,
    n_drivers: int | None = None,
    *,
    seed: int = 42,
) -> tuple[list[OrderIn], list[DriverIn]]:
    rng = random.Random(seed)
    driver_count = n_drivers if n_drivers is not None else max(4, (n_orders + 14) // 15)
    regions = ("north", "south")
    orders: list[OrderIn] = []
    for index in range(n_orders):
        region = regions[index % 2]
        base_lat = 47.125 if region == "north" else 47.065
        base_lon = 51.925 if region == "north" else 51.845
        pickup_lat = base_lat + rng.uniform(-0.018, 0.018)
        pickup_lon = base_lon + rng.uniform(-0.018, 0.018)
        # ``seats`` already includes every twin and accompanying passenger.
        if (index + 1) % 97 == 0:
            twin_size = 3
            seats = rng.choice((5, 6))
        elif (index + 1) % 29 == 0:
            twin_size = 2
            seats = rng.choice((3, 4))
        else:
            twin_size = 1
            seats = 2 if index % 17 == 0 else 1
        orders.append(
            OrderIn(
                f"O{index:04d}",
                480 + (index * 7) % 600 + rng.randint(-2, 2),
                pickup_lat,
                pickup_lon,
                pickup_lat + rng.uniform(-0.012, 0.012),
                pickup_lon + rng.uniform(-0.012, 0.012),
                seats,
                twin_size,
                region,
            )
        )
    drivers = []
    for index in range(driver_count):
        region = regions[index % 2]
        base_lat = 47.125 if region == "north" else 47.065
        base_lon = 51.925 if region == "north" else 51.845
        drivers.append(
            DriverIn(
                f"D{index:03d}",
                region,
                6 if index % 5 == 0 else 4,
                base_lat + rng.uniform(-0.01, 0.01),
                base_lon + rng.uniform(-0.01, 0.01),
            )
        )
    return orders, drivers
