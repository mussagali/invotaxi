"""Atyrau road-distance model with explicit river crossings."""

from __future__ import annotations

import math
from functools import lru_cache

from routing.types import DistanceProvider

R_EARTH_KM = 6371.0
OLD_BRIDGE = (47.0985, 51.9070)
NEW_BRIDGE = (47.0820, 51.9230)
BRIDGES = (OLD_BRIDGE, NEW_BRIDGE)

SOUTH_BANK_ANCHORS = (
    (46.973556, 51.784996),
    (47.032944, 51.851934),
    (47.042474, 51.811421),
    (47.060093, 51.831310),
    (47.072966, 51.853324),
    (47.074536, 51.864915),
    (47.076593, 51.839424),
    (47.091410, 51.861305),
)
NORTH_BANK_ANCHORS = (
    (47.083575, 51.878225),
    (47.091548, 51.898834),
    (47.095486, 51.942174),
    (47.099215, 51.882413),
    (47.106033, 51.888070),
    (47.109536, 51.898834),
    (47.117545, 51.935322),
    (47.120411, 51.887345),
    (47.126258, 51.939742),
    (47.127812, 51.952117),
    (47.138489, 51.986100),
    (47.148378, 52.029362),
    (47.153153, 51.984147),
    (47.162071, 51.832348),
    (47.170184, 51.984616),
    (47.170437, 51.915478),
    (47.196076, 51.950424),
    (47.226564, 51.797689),
    (47.237363, 51.947923),
)

ATYRAU_BBOX = (46.85, 47.35, 51.55, 52.15)
KAZAKHSTAN_BBOX = (40.45, 55.50, 46.40, 87.40)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    )
    return 2.0 * R_EARTH_KM * math.asin(math.sqrt(a))


def bearing_degrees(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial compass bearing in degrees in the range [0, 360)."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    delta_lon = math.radians(lon2 - lon1)
    y = math.sin(delta_lon) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(
        phi2
    ) * math.cos(delta_lon)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def bearing_difference(first: float, second: float) -> float:
    """Smallest angular distance between two compass bearings."""
    return abs((first - second + 180.0) % 360.0 - 180.0)


@lru_cache(maxsize=16_384)
def _bank_of_rounded(lat: float, lon: float) -> str:
    best_bank = "south"
    best_distance = math.inf
    for bank, anchors in (("south", SOUTH_BANK_ANCHORS), ("north", NORTH_BANK_ANCHORS)):
        for anchor_lat, anchor_lon in anchors:
            distance = haversine_km(lat, lon, anchor_lat, anchor_lon)
            if distance < best_distance:
                best_bank, best_distance = bank, distance
    return best_bank


def bank_of(lat: float, lon: float) -> str:
    return _bank_of_rounded(round(lat, 5), round(lon, 5))


def in_bbox(lat: float, lon: float) -> bool:
    lat_min, lat_max, lon_min, lon_max = KAZAKHSTAN_BBOX
    return lat_min <= lat <= lat_max and lon_min <= lon <= lon_max


def in_atyrau_bbox(lat: float, lon: float) -> bool:
    lat_min, lat_max, lon_min, lon_max = ATYRAU_BBOX
    return lat_min <= lat <= lat_max and lon_min <= lon <= lon_max


class AtyrauDistanceProvider(DistanceProvider):
    def __init__(self, avg_speed_kmh: float = 28.0, winding: float = 1.35) -> None:
        self.avg_speed_kmh = avg_speed_kmh
        self.winding = winding

    def distance_km(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        if not (in_atyrau_bbox(lat1, lon1) and in_atyrau_bbox(lat2, lon2)):
            return haversine_km(lat1, lon1, lat2, lon2) * self.winding
        if bank_of(lat1, lon1) == bank_of(lat2, lon2):
            return haversine_km(lat1, lon1, lat2, lon2) * self.winding
        return min(
            (
                haversine_km(lat1, lon1, bridge_lat, bridge_lon)
                + haversine_km(bridge_lat, bridge_lon, lat2, lon2)
            )
            * self.winding
            for bridge_lat, bridge_lon in BRIDGES
        )

    def time_minutes(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        return self.distance_km(lat1, lon1, lat2, lon2) / self.avg_speed_kmh * 60.0


def provider_for(avg_speed_kmh: float, winding: float) -> AtyrauDistanceProvider:
    return AtyrauDistanceProvider(avg_speed_kmh, winding)
