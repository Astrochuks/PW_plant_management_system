"""Lightweight in-memory TTL cache for frequently-read, rarely-changing data.

Used for data like locations and fleet types that get requested on every
page load but only change when an admin creates/edits/deletes records.

Thread-safe via the GIL for dict reads/writes in CPython.
"""

import time
from typing import Any

_cache: dict[str, tuple[float, Any]] = {}


def get(key: str) -> Any | None:
    """Return cached value if it exists and hasn't expired."""
    entry = _cache.get(key)
    if entry is None:
        return None
    expires_at, value = entry
    if time.monotonic() > expires_at:
        _cache.pop(key, None)
        return None
    return value


def put(key: str, value: Any, ttl_seconds: int = 300) -> None:
    """Store a value in the cache with a TTL."""
    _cache[key] = (time.monotonic() + ttl_seconds, value)


def invalidate(key: str) -> None:
    """Remove a specific key from the cache."""
    _cache.pop(key, None)


def invalidate_prefix(prefix: str) -> None:
    """Remove all keys starting with the given prefix."""
    keys_to_remove = [k for k in _cache if k.startswith(prefix)]
    for k in keys_to_remove:
        _cache.pop(k, None)
