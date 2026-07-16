"""Build CONCLUSION.md exclusively from measured profile reports."""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path


@dataclass(frozen=True)
class Result:
    profile: str
    resources: str
    verdict: str
    p95: str
    dispatch: str


def match(pattern: str, text: str, default: str = "n/a") -> str:
    found = re.search(pattern, text, re.MULTILINE)
    return found.group(1).strip() if found else default


def read_result(path: Path) -> Result:
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    return Result(
        profile=match(r"^# P9 result — (.+)$", text, path.stem),
        resources=match(r"^- Resource profile: \*\*(.+)\*\*$", text),
        verdict=match(r"^- Verdict: \*\*(PASS|FAIL)\*\*$", text, "FAIL"),
        p95=match(r"^\| \*\*all HTTP\*\* \| \*\*(.+)\*\* \|$", text),
        dispatch=match(r"^- Dispatch: (.+)$", text),
    )


def doubled(resources: str) -> str:
    numbers = [int(item) * 2 for item in re.findall(r"\d+", resources)]
    return f"{numbers[0]} vCPU / {numbers[1]} GiB" if len(numbers) >= 2 else "n/a"


def main(paths: list[str]) -> int:
    results = [read_result(Path(item)) for item in paths]
    passed = next((item for item in results if item.verdict == "PASS"), None)

    print("# P9 — заключение по нагрузочному тесту")
    print()
    print(f"Сформировано: {datetime.now(UTC).isoformat(timespec='seconds')} UTC.")
    print()
    print("| Профиль | HTTP p95 | Dispatch 600 | Пороги |")
    print("|---|---:|---|---|")
    for item in results:
        print(f"| {item.resources} | {item.p95} | {item.dispatch} | {item.verdict} |")
    print()
    if passed is None:
        print(
            "Ни один профиль не прошёл все пороги. Минимальная конфигурация не определена; "
            "нужны тюнинг и повторный полный прогон."
        )
    else:
        print(f"**Минимальная измеренная конфигурация — {passed.resources}.**")
        print()
        print(f"Рекомендация с запасом ×2 — **{doubled(passed.resources)}**.")
    print()
    print(
        "Вывод основан только на `loadtest/results/*.md`; при изменении кода, базы, "
        "Docker/ядра или железа матрицу следует повторить."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
