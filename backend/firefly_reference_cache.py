"""In-process TTL cache for slow-changing Firefly reference data."""

from __future__ import annotations

import os
import time
from typing import Any

_DEFAULT_TTL_SECONDS = 2 * 3600

_entries: dict[str, tuple[Any, float]] = {}


def ttl_seconds() -> int:
    raw = os.environ.get("FIREFLY_REFERENCE_CACHE_TTL_SECONDS", "").strip()
    if raw:
        return int(raw)
    return _DEFAULT_TTL_SECONDS


def get(key: str) -> Any | None:
    entry = _entries.get(key)
    if entry is None:
        return None
    value, expires_at = entry
    if time.monotonic() >= expires_at:
        del _entries[key]
        return None
    return value


def set(key: str, value: Any) -> None:
    _entries[key] = (value, time.monotonic() + ttl_seconds())


def clear() -> None:
    _entries.clear()
