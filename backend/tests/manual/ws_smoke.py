"""Manual 500-connection smoke.

Usage:
  python tests/manual/ws_smoke.py --url ws://localhost:8000/api/v1/ws --tokens tokens.txt

The token file must contain at least 500 access tokens (one per line), because the
server intentionally limits each user to three simultaneous connections.
"""

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import websockets


def rss_bytes() -> int:
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        class MemoryCounters(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        counters = MemoryCounters()
        counters.cb = ctypes.sizeof(counters)
        process = ctypes.windll.kernel32.GetCurrentProcess()  # type: ignore[attr-defined]
        ctypes.windll.psapi.GetProcessMemoryInfo(  # type: ignore[attr-defined]
            process, ctypes.byref(counters), counters.cb
        )
        return int(counters.WorkingSetSize)
    with Path("/proc/self/statm").open(encoding="ascii") as statm:
        return int(statm.read().split()[1]) * os.sysconf("SC_PAGE_SIZE")


async def keep_alive(socket: Any, stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            raw = await asyncio.wait_for(socket.recv(), timeout=1)
        except TimeoutError:
            continue
        message = json.loads(raw)
        if message.get("type") == "ping":
            await socket.send(json.dumps({"type": "pong"}))


async def run(url: str, tokens: list[str], duration: int) -> None:
    before = rss_bytes()
    sockets = await asyncio.gather(
        *(websockets.connect(f"{url}?token={token}") for token in tokens)
    )
    connected = rss_bytes()
    stop = asyncio.Event()
    tasks = [asyncio.create_task(keep_alive(socket, stop)) for socket in sockets]
    started = time.monotonic()
    await asyncio.sleep(duration)
    stop.set()
    await asyncio.gather(*tasks)
    await asyncio.gather(*(socket.close() for socket in sockets))
    after = rss_bytes()
    mib = 1024 * 1024
    print(f"connections={len(sockets)} held={time.monotonic() - started:.1f}s")
    print(
        f"client_rss_before={before / mib:.1f}MiB "
        f"connected={connected / mib:.1f}MiB after={after / mib:.1f}MiB "
        f"delta={(after - before) / mib:.1f}MiB"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--tokens", type=Path, required=True)
    parser.add_argument("--connections", type=int, default=500)
    parser.add_argument("--duration", type=int, default=60)
    args = parser.parse_args()
    tokens = [line.strip() for line in args.tokens.read_text().splitlines() if line.strip()]
    if len(tokens) < args.connections:
        parser.error(f"need {args.connections} tokens, got {len(tokens)}")
    asyncio.run(run(args.url, tokens[: args.connections], args.duration))


if __name__ == "__main__":
    main()
