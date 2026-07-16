"""Golden determinism snapshots and the 600/40 performance gate."""

from __future__ import annotations

import hashlib
import time

import pytest

from routing import EngineConfig, Solution, solve
from tests.routing.data import generate_dataset


def digest(solution: Solution) -> str:
    public = (
        solution.routes,
        solution.lunches,
        sorted(solution.unassigned),
        solution.validation,
        solution.stats,
    )
    return hashlib.sha256(repr(public).encode()).hexdigest()


SNAPSHOTS = {
    50: "f6ac969b1d898ffb299d000baafe28951648a2630623cfe501a3ad54e4534126",
    250: "0f206f28c9778651b09cf9400e9d75f754e3402ea3d11c6ab7a09776ed1c8000",
    600: "ecb58ef0fc68b9cb65afe7fbe06220b1e0b3cd772c24ea960a36aedef336910f",
}


@pytest.mark.parametrize("size", [50, 250, 600])
def test_golden_deterministic_snapshot_and_performance(size: int) -> None:
    orders, drivers = generate_dataset(size, 40 if size == 600 else None)
    cfg = EngineConfig(min_orders=3, rental_min_orders=3)
    started = time.perf_counter()
    first = solve(orders, drivers, cfg)
    elapsed = time.perf_counter() - started
    second = solve(orders, drivers, EngineConfig(min_orders=3, rental_min_orders=3))
    assert first == second
    assert digest(first) == SNAPSHOTS[size]
    assert first.validation.is_valid
    if size == 600 and not _coverage_tracing():
        # The 60s gate is measured on uninstrumented runs (CI runs plain
        # pytest); coverage tracing slows solve() ~3-4x and is not the
        # thing this gate protects.
        assert elapsed < 60


def _coverage_tracing() -> bool:
    try:
        import coverage
    except ImportError:
        return False
    return coverage.Coverage.current() is not None
