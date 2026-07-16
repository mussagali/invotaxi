"""Public input and output types for the routing engine."""

from __future__ import annotations

from dataclasses import dataclass, field
from math import inf
from typing import Literal, Protocol


class DistanceProvider(Protocol):
    """Single abstraction point for replacing the built-in geo model."""

    def distance_km(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Return road distance in kilometres."""

    def time_minutes(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Return road travel time in minutes."""


@dataclass(frozen=True, slots=True)
class OrderIn:
    id: str
    t_min: int
    pickup_lat: float
    pickup_lon: float
    dropoff_lat: float
    dropoff_lon: float
    seats: int
    twin_size: int = 1
    region: str = "default"


@dataclass(frozen=True, slots=True)
class DriverIn:
    id: str
    region: str
    capacity: int
    start_lat: float
    start_lon: float


@dataclass(slots=True)
class EngineConfig:
    time_window_slack: int = 15
    service_time_min: int = 12
    radii_km: tuple[float, ...] = (2.0, 5.0, 10.0, inf)
    min_orders: int = 10
    max_orders: int = 15
    minivan_run_size: int = 3
    minivan_peak_windows: tuple[tuple[int, int], ...] = (
        (420, 540),
        (630, 690),
        (750, 810),
        (870, 930),
        (960, 1080),
    )
    minivan_time_cluster_min: int = 15
    minivan_pickup_proximity_km: float = 1.5
    minivan_dropoff_direction_deg: float = 40.0
    minivan_long_haul_km: float = 6.0
    pool_max_km: float = 7.0
    pool_max_time_diff: int = 45
    lunch_window: tuple[int, int] = (630, 930)
    lunch_min: int = 60
    lunch_max: int = 120
    avg_speed_kmh: float = 28.0
    winding: float = 1.35
    n_rental: int = 3
    rental_min_orders: int = 11
    distance_provider: DistanceProvider | None = None
    enforce_capacity: bool = True
    sort_group_pool_by_distance: bool = True
    include_edge_lunch_gaps: bool = True
    consolidate_rentals: bool = True

    @classmethod
    def legacy(cls) -> EngineConfig:
        """Build config emulating only the pre-B1/B2/B3/B4 checks."""
        cfg = cls()
        cfg.enforce_capacity = False
        cfg.sort_group_pool_by_distance = False
        cfg.include_edge_lunch_gaps = False
        cfg.consolidate_rentals = False
        return cfg


@dataclass(frozen=True, slots=True)
class Stop:
    order_id: str
    lat: float
    lon: float
    time: float


@dataclass(frozen=True, slots=True)
class Block:
    kind: Literal["trip", "run"]
    order_ids: tuple[str, ...]
    pickup_seq: tuple[Stop, ...]
    dropoff_seq: tuple[Stop, ...]
    start_time: float
    end_time: float


@dataclass(frozen=True, slots=True)
class Lunch:
    start_min: float
    end_min: float
    full: bool


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    code: Literal["duplicate", "time_window", "bbox", "capacity", "coverage"]
    message: str
    driver_id: str | None = None
    order_id: str | None = None


@dataclass(frozen=True, slots=True)
class ValidationReport:
    issues: tuple[ValidationIssue, ...] = ()

    @property
    def is_valid(self) -> bool:
        return not self.issues

    def count(self, code: str) -> int:
        return sum(issue.code == code for issue in self.issues)


@dataclass(frozen=True, slots=True)
class SolutionStats:
    total_orders: int
    assigned_orders: int
    unassigned_orders: int
    active_drivers: int
    rental_drivers: int
    dissolved_drivers: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class DriverPosition:
    lat: float
    lon: float
    available_at: float = 0.0


@dataclass(slots=True)
class Solution:
    routes: dict[str, list[Block]]
    lunches: dict[str, Lunch]
    unassigned: set[str]
    validation: ValidationReport
    stats: SolutionStats
    _orders: dict[str, OrderIn] = field(default_factory=dict, repr=False, compare=False)
    _drivers: dict[str, DriverIn] = field(default_factory=dict, repr=False, compare=False)
    _config: EngineConfig = field(default_factory=EngineConfig, repr=False, compare=False)
