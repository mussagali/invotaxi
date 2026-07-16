"""Render reproducible P9 Markdown from k6, docker stats and PostgreSQL output."""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from statistics import mean
from typing import Any

UNITS = {
    "B": 1,
    "kB": 1000,
    "KB": 1000,
    "KiB": 1024,
    "MB": 1000**2,
    "MiB": 1024**2,
    "GB": 1000**3,
    "GiB": 1024**3,
}
SERVICES = ("api", "worker", "postgres", "redis")


def duration_seconds(value: str) -> int:
    match = re.fullmatch(r"(\d+)(s|m|h)", value)
    if match is None:
        raise ValueError(f"unsupported duration {value!r}")
    return int(match.group(1)) * {"s": 1, "m": 60, "h": 3600}[match.group(2)]


def bytes_value(value: str) -> float:
    match = re.fullmatch(r"([0-9.]+)([A-Za-z]+)", value.strip())
    if match is None:
        return 0.0
    return float(match.group(1)) * UNITS.get(match.group(2), 0)


def service_from_name(name: str) -> str | None:
    for service in SERVICES:
        if re.search(rf"-{service}-\d+$", name):
            return service
    return None


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as handle:
        value: dict[str, Any] = json.load(handle)
        return value


def stats_values(path: Path, steady_start: int) -> tuple[dict[str, float], dict[str, float]]:
    ram_by_sample: dict[tuple[int, str], float] = defaultdict(float)
    cpu_by_sample: dict[tuple[int, str], float] = defaultdict(float)
    if path.exists():
        for raw in path.read_text(encoding="utf-8").splitlines():
            try:
                timestamp_raw, payload = raw.split("\t", 1)
                timestamp = int(timestamp_raw)
                row = json.loads(payload)
                service = service_from_name(str(row.get("Name", "")))
                if service is None:
                    continue
                used = str(row.get("MemUsage", "0B / 0B")).split("/", 1)[0]
                ram_by_sample[(timestamp, service)] += bytes_value(used)
                if timestamp >= steady_start:
                    cpu_by_sample[(timestamp, service)] += float(
                        str(row.get("CPUPerc", "0")).rstrip("%") or 0
                    )
            except (ValueError, TypeError, json.JSONDecodeError):
                continue
    peaks = {
        service: max(
            (value for (_, item), value in ram_by_sample.items() if item == service),
            default=0.0,
        )
        for service in SERVICES
    }
    steady = {
        service: mean(
            [value for (_, item), value in cpu_by_sample.items() if item == service]
        )
        if any(item == service for _, item in cpu_by_sample)
        else 0.0
        for service in SERVICES
    }
    return peaks, steady


def thresholds(summary: dict[str, Any]) -> tuple[bool, list[tuple[str, bool]]]:
    rows: list[tuple[str, bool]] = []
    for metric_name, metric in summary.get("metrics", {}).items():
        for expression, result in metric.get("thresholds", {}).items():
            # k6 summary-export stores a primitive "lastFailed" flag (false means PASS).
            ok = bool(result.get("ok")) if isinstance(result, dict) else not bool(result)
            rows.append((f"{metric_name}: {expression}", ok))
    return bool(rows) and all(ok for _, ok in rows), rows


def metric_value(summary: dict[str, Any], metric: str, key: str) -> float | None:
    row = summary.get("metrics", {}).get(metric, {})
    value = row.get("values", {}).get(key) if "values" in row else row.get(key)
    if value is None and key == "rate":
        # k6 summary-export serializes Rate metrics as a single `value` field.
        value = row.get("value")
    return float(value) if value is not None else None


def dispatch_values(path: Path) -> tuple[str, float | None, int | None]:
    if not path.exists():
        return "missing", None, None
    raw = path.read_text(encoding="utf-8").strip().replace("\\t", "\t").replace("|", "\t")
    parts = raw.split("\t")
    if len(parts) != 3:
        return "missing", None, None
    try:
        return parts[0], float(parts[1]), int(parts[2])
    except ValueError:
        return parts[0], None, None


def fmt_ms(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.1f} ms"


def render_result(args: argparse.Namespace) -> int:
    summary = load_json(args.summary)
    all_ok, threshold_rows = thresholds(summary)
    peaks, steady = stats_values(
        args.stats, args.started_at + duration_seconds(args.ramp_duration)
    )
    dispatch_status, dispatch_duration, dispatch_orders = dispatch_values(args.dispatch)
    run_ok = args.k6_exit == 0 and all_ok and dispatch_status == "done" and dispatch_orders == 600

    print(f"# P9 result — {args.profile}")
    print()
    print(f"- UTC: {datetime.now(UTC).isoformat(timespec='seconds')}")
    print(f"- Resource profile: **{args.resources}**")
    print(
        f"- Duration: **{args.test_duration}** "
        f"(ramp-up {args.ramp_duration}, steady {args.steady_duration})"
    )
    print("- Workload: 250 drivers, 1100 clients, 150 dispatcher requests/min")
    print(f"- k6 exit code: `{args.k6_exit}`")
    print(f"- Verdict: **{'PASS' if run_ok else 'FAIL'}**")
    print()
    print("## Thresholds")
    print()
    print("| Threshold | Result |")
    print("|---|---|")
    if threshold_rows:
        for name, ok in threshold_rows:
            print(f"| `{name}` | {'PASS' if ok else 'FAIL'} |")
    else:
        print("| k6 summary unavailable | FAIL |")

    print()
    print("## HTTP by persona")
    print()
    print("| Persona | p95 |")
    print("|---|---:|")
    for persona in ("driver", "client", "dispatcher", "dispatch-job"):
        name = f"http_req_duration{{persona:{persona}}}"
        print(f"| {persona} | {fmt_ms(metric_value(summary, name, 'p(95)'))} |")
    print(f"| **all HTTP** | **{fmt_ms(metric_value(summary, 'http_req_duration', 'p(95)'))}** |")

    print()
    print("## Throughput and reliability")
    print()
    print(f"- HTTP RPS: {metric_value(summary, 'http_reqs', 'rate') or 0:.2f}")
    error_rate = (metric_value(summary, "http_req_failed", "rate") or 0) * 100
    disconnect_rate = (metric_value(summary, "ws_disconnect_rate", "rate") or 0) * 100
    print(f"- HTTP error rate: {error_rate:.4f}%")
    print(f"- WS abnormal disconnect rate: {disconnect_rate:.4f}%")
    orders = dispatch_orders if dispatch_orders is not None else "n/a"
    duration = f"{dispatch_duration:.2f} s" if dispatch_duration is not None else "n/a"
    print(
        "- Dispatch: "
        f"status={dispatch_status}, orders={orders}, duration={duration}"
    )

    print()
    print("## Containers")
    print()
    print("| Service | Peak RAM | Steady CPU |")
    print("|---|---:|---:|")
    for service in SERVICES:
        print(f"| {service} | {peaks[service] / 1024**2:.1f} MiB | {steady[service]:.1f}% |")
    return 0 if run_ok else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("--resources", required=True)
    parser.add_argument("--summary", type=Path, required=True)
    parser.add_argument("--stats", type=Path, required=True)
    parser.add_argument("--dispatch", type=Path, required=True)
    parser.add_argument("--started-at", type=int, required=True)
    parser.add_argument("--ramp-duration", required=True)
    parser.add_argument("--test-duration", required=True)
    parser.add_argument("--steady-duration", required=True)
    parser.add_argument("--k6-exit", type=int, required=True)
    return render_result(parser.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
