"""Lunch selection from natural route gaps."""

from __future__ import annotations

from routing.core import RouteState
from routing.types import EngineConfig, Lunch


def assign_lunch(route: RouteState, cfg: EngineConfig) -> Lunch | None:
    if not route.blocks:
        return None
    window_start, window_end = cfg.lunch_window
    gaps: list[tuple[float, float, float]] = []
    if cfg.include_edge_lunch_gaps:
        first_start = route.blocks[0].start_time
        if first_start > window_start:
            end = min(first_start, float(window_end))
            if end > window_start:
                gaps.append((end - window_start, float(window_start), end))
    for previous, current in zip(route.blocks, route.blocks[1:], strict=False):
        start = max(previous.end_time, float(window_start))
        end = min(current.start_time, float(window_end))
        if end > start:
            gaps.append((end - start, start, end))
    if cfg.include_edge_lunch_gaps:
        last_end = route.blocks[-1].end_time
        start = max(last_end, float(window_start))
        if window_end > start:
            gaps.append((window_end - start, start, float(window_end)))
    if not gaps:
        return None
    length, start, _ = min(gaps, key=lambda item: (-item[0], item[1]))
    duration = min(float(cfg.lunch_max), length)
    lunch = Lunch(start, start + duration, length >= cfg.lunch_min)
    route.lunch = lunch
    return lunch
