"""Pure parsing and window helpers for the load-test collector."""

from __future__ import annotations

import math
import re
import statistics
from datetime import datetime, timezone

_MEMORY_UNIT = re.compile(r"^\s*([0-9]+(?:\.[0-9]+)?)\s*(B|kB|KB|KiB|MB|MiB|GB|GiB|TB|TiB)\s*$")
_MEMORY_FACTORS = {
    "B": 1,
    "kB": 1000,
    "KB": 1000,
    "KiB": 1024,
    "MB": 1000**2,
    "MiB": 1024**2,
    "GB": 1000**3,
    "GiB": 1024**3,
    "TB": 1000**4,
    "TiB": 1024**4,
}


def _one_memory_value(value: str) -> int:
    match = _MEMORY_UNIT.match(value)
    if not match:
        raise ValueError(f"unrecognized Docker memory value: {value!r}")
    return int(float(match.group(1)) * _MEMORY_FACTORS[match.group(2)])


def docker_memory_bytes(value: str) -> tuple[int, int]:
    """Parse Docker's ``used / limit`` string as byte counts."""
    parts = value.split("/", 1)
    if len(parts) != 2:
        raise ValueError(f"unrecognized Docker memory usage: {value!r}")
    return _one_memory_value(parts[0]), _one_memory_value(parts[1])


def percentile_summary(values: list[float]) -> dict[str, float | int | None]:
    """Return count, median, and linearly interpolated inclusive p95."""
    if not values:
        return {"count": 0, "median": None, "p95": None}
    ordered = sorted(float(value) for value in values)
    if not all(math.isfinite(value) for value in ordered):
        raise ValueError("percentile values must be finite")
    rank = 0.95 * (len(ordered) - 1)
    lower = math.floor(rank)
    upper = math.ceil(rank)
    p95 = ordered[lower] + (ordered[upper] - ordered[lower]) * (rank - lower)
    return {"count": len(ordered), "median": statistics.median(ordered), "p95": p95}


def minute_buckets(
    rows: list[tuple[float, int, int, int]], start: float, end: float
) -> list[dict[str, int | float | bool | str]]:
    """Format SQL calendar-minute counts and mark partial UTC window overlaps."""
    if end <= start:
        raise ValueError("measurement end must follow start")
    counts = {int(float(minute)): (successful, failed, unknown)
              for minute, successful, failed, unknown in rows}
    first_minute = math.floor(start / 60.0) * 60
    buckets = []
    minute_start = first_minute
    while minute_start < end:
        overlap_start = max(start, minute_start)
        overlap_end = min(end, minute_start + 60)
        successful, failed, unknown = counts.get(minute_start, (0, 0, 0))
        buckets.append({
            "minute_utc": datetime.fromtimestamp(minute_start, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "successful": int(successful),
            "failed": int(failed),
            "unknown": int(unknown),
            "window_seconds": round(overlap_end - overlap_start, 6),
            "partial": overlap_end - overlap_start < 60,
        })
        minute_start += 60
    return buckets
