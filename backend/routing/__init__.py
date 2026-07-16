"""Pure, deterministic routing engine."""

__version__ = "1.0.0"

from routing.engine import solve
from routing.geo import AtyrauDistanceProvider
from routing.online import online_insert
from routing.types import (
    Block,
    DistanceProvider,
    DriverIn,
    DriverPosition,
    EngineConfig,
    Lunch,
    OrderIn,
    Solution,
    SolutionStats,
    Stop,
    ValidationIssue,
    ValidationReport,
)
from routing.validate import validate

__all__ = [
    "Block",
    "AtyrauDistanceProvider",
    "DriverIn",
    "DriverPosition",
    "DistanceProvider",
    "EngineConfig",
    "Lunch",
    "OrderIn",
    "Solution",
    "SolutionStats",
    "Stop",
    "ValidationIssue",
    "ValidationReport",
    "online_insert",
    "solve",
    "validate",
]
