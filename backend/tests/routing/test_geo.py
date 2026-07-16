"""Tests for the bridge-aware Atyrau geometry."""

from routing.geo import (
    NORTH_BANK_ANCHORS,
    SOUTH_BANK_ANCHORS,
    AtyrauDistanceProvider,
    bank_of,
    haversine_km,
    in_bbox,
)


def test_bank_of_anchor_points_and_cache() -> None:
    assert bank_of(*SOUTH_BANK_ANCHORS[0]) == "south"
    assert bank_of(*NORTH_BANK_ANCHORS[0]) == "north"
    assert bank_of(47.0835751, 51.8782251) == bank_of(47.0835752, 51.8782252)


def test_cross_bank_distance_goes_through_bridge() -> None:
    provider = AtyrauDistanceProvider()
    south = SOUTH_BANK_ANCHORS[7]
    north = NORTH_BANK_ANCHORS[2]
    direct = haversine_km(*south, *north) * provider.winding
    assert provider.distance_km(*south, *north) > direct
    assert provider.time_minutes(*south, *north) > 0


def test_bbox() -> None:
    assert in_bbox(47.1, 51.9)
    assert in_bbox(51.1694, 71.4491)  # Astana
    assert in_bbox(43.2389, 76.8897)  # Almaty
    assert not in_bbox(39.0, 71.0)
