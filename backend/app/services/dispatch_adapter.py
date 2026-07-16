"""Boundary between SQLAlchemy product models and the pure routing engine."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, fields
from typing import Any

from app.domain.models import Driver, Order
from app.domain.schemas import (
    KAZAKHSTAN_LAT_MAX,
    KAZAKHSTAN_LAT_MIN,
    KAZAKHSTAN_LON_MAX,
    KAZAKHSTAN_LON_MIN,
)
from routing import DriverIn, EngineConfig, OrderIn

KAZAKHSTAN_FALLBACK = (48.0196, 66.9237)


@dataclass(slots=True)
class AdaptedDispatch:
    orders: list[OrderIn]
    drivers: list[DriverIn]
    config: EngineConfig
    members_by_representative: dict[str, tuple[uuid.UUID, ...]]
    representative_by_order: dict[uuid.UUID, str]
    rejected_order_ids: set[uuid.UUID]
    anomalies: list[dict[str, Any]]

    def expand(self, engine_order_id: str) -> tuple[uuid.UUID, ...]:
        return self.members_by_representative.get(
            engine_order_id, (uuid.UUID(engine_order_id),)
        )


def _in_bbox(lat: float | None, lon: float | None) -> bool:
    return (
        lat is not None
        and lon is not None
        and KAZAKHSTAN_LAT_MIN <= lat <= KAZAKHSTAN_LAT_MAX
        and KAZAKHSTAN_LON_MIN <= lon <= KAZAKHSTAN_LON_MAX
    )


def engine_config(overrides: dict[str, Any] | None = None) -> EngineConfig:
    allowed = {item.name for item in fields(EngineConfig)} - {"distance_provider"}
    values = dict(overrides or {})
    unknown = sorted(set(values) - allowed)
    if unknown:
        raise ValueError(f"unknown routing config fields: {', '.join(unknown)}")
    if "radii_km" in values:
        values["radii_km"] = tuple(float(item) for item in values["radii_km"])
    if "lunch_window" in values:
        values["lunch_window"] = tuple(int(item) for item in values["lunch_window"])
    # Virtual rentals have no corresponding drivers row and cannot cross the app DB boundary.
    values["n_rental"] = 0
    return EngineConfig(**values)


def adapt_dispatch(
    orders: list[Order],
    drivers: list[Driver],
    district: str,
    config_overrides: dict[str, Any] | None = None,
) -> AdaptedDispatch:
    """Normalize coordinates and collapse twin groups into engine input units."""
    valid_starts: list[tuple[float, float]] = []
    for driver in drivers:
        if _in_bbox(driver.home_lat, driver.home_lon):
            assert driver.home_lat is not None and driver.home_lon is not None
            valid_starts.append((driver.home_lat, driver.home_lon))
    valid_order_points = [
        (order.pickup_lat, order.pickup_lon)
        for order in orders
        if _in_bbox(order.pickup_lat, order.pickup_lon)
        and order.pickup_lat is not None
        and order.pickup_lon is not None
    ]
    if valid_starts:
        fallback_lat = sum(item[0] for item in valid_starts) / len(valid_starts)
        fallback_lon = sum(item[1] for item in valid_starts) / len(valid_starts)
    elif valid_order_points:
        fallback_lat = sum(item[0] for item in valid_order_points) / len(valid_order_points)
        fallback_lon = sum(item[1] for item in valid_order_points) / len(valid_order_points)
    else:
        fallback_lat, fallback_lon = KAZAKHSTAN_FALLBACK

    anomalies: list[dict[str, Any]] = []
    driver_inputs: list[DriverIn] = []
    for driver in drivers:
        if _in_bbox(driver.home_lat, driver.home_lon):
            assert driver.home_lat is not None and driver.home_lon is not None
            lat, lon = driver.home_lat, driver.home_lon
        else:
            lat, lon = fallback_lat, fallback_lon
            anomalies.append(
                {
                    "type": "driver_start_replaced",
                    "driver_id": str(driver.user_id),
                    "original": {"lat": driver.home_lat, "lon": driver.home_lon},
                    "replacement": {"lat": lat, "lon": lon},
                }
            )
        driver_inputs.append(
            DriverIn(str(driver.user_id), district, driver.capacity, lat, lon)
        )

    grouped: dict[str, list[Order]] = {}
    rejected: set[uuid.UUID] = set()
    for order in orders:
        coordinates = (
            _in_bbox(order.pickup_lat, order.pickup_lon)
            and _in_bbox(order.dropoff_lat, order.dropoff_lon)
        )
        if not coordinates:
            rejected.add(order.id)
            anomalies.append(
                {
                    "type": "order_coordinates_invalid",
                    "order_id": str(order.id),
                }
            )
            continue
        key = f"twin:{order.twin_group_id}" if order.twin_group_id else f"order:{order.id}"
        grouped.setdefault(key, []).append(order)

    order_inputs: list[OrderIn] = []
    members: dict[str, tuple[uuid.UUID, ...]] = {}
    representative_by_order: dict[uuid.UUID, str] = {}
    for rows in grouped.values():
        rows.sort(key=lambda item: str(item.id))
        representative = rows[0]
        assert representative.pickup_lat is not None
        assert representative.pickup_lon is not None
        assert representative.dropoff_lat is not None
        assert representative.dropoff_lon is not None
        representative_id = str(representative.id)
        member_ids = tuple(item.id for item in rows)
        members[representative_id] = member_ids
        representative_by_order.update({item.id: representative_id for item in rows})
        order_inputs.append(
            OrderIn(
                id=representative_id,
                t_min=representative.desired_time.hour * 60 + representative.desired_time.minute,
                pickup_lat=representative.pickup_lat,
                pickup_lon=representative.pickup_lon,
                dropoff_lat=representative.dropoff_lat,
                dropoff_lon=representative.dropoff_lon,
                seats=sum(item.seats for item in rows),
                twin_size=len(rows),
                region=district,
            )
        )
    order_inputs.sort(key=lambda item: (item.t_min, item.id))
    driver_inputs.sort(key=lambda item: item.id)
    return AdaptedDispatch(
        order_inputs,
        driver_inputs,
        engine_config(config_overrides),
        members,
        representative_by_order,
        rejected,
        anomalies,
    )
