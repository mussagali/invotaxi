"""Gunicorn hooks required by prometheus_client multiprocess mode."""

from prometheus_client import multiprocess


def child_exit(server: object, worker: object) -> None:
    """Remove dead worker gauge shards after graceful or forced exits."""
    multiprocess.mark_process_dead(worker.pid)  # type: ignore[attr-defined]
