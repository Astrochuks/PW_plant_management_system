"""In-memory event bus for real-time SSE broadcasting.

When a mutation happens (project import, plant create, transfer, etc.),
call `broadcast(entity, action)`. All connected SSE clients receive the
event and can invalidate their local caches.

This is intentionally simple — no Redis, no external broker. Works for
single-process deployments (Render, Railway, etc.). If you scale to
multiple workers, swap this for Redis Pub/Sub.
"""

import asyncio
import json
import time
from typing import AsyncGenerator

from app.monitoring.logging import get_logger

logger = get_logger(__name__)

# All connected client queues
_subscribers: set[asyncio.Queue] = set()


def subscribe() -> asyncio.Queue:
    """Register a new SSE client. Returns a queue that receives events."""
    q: asyncio.Queue = asyncio.Queue(maxsize=64)
    _subscribers.add(q)
    logger.debug("SSE client connected", total=len(_subscribers))
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    """Remove an SSE client."""
    _subscribers.discard(q)
    logger.debug("SSE client disconnected", total=len(_subscribers))


def broadcast(entity: str, action: str, summary: str | None = None) -> None:
    """Push an event to all connected SSE clients.

    Args:
        entity: The data type that changed (e.g. "projects", "plants", "transfers").
        action: What happened (e.g. "import", "create", "update", "delete").
        summary: Optional human-readable description.
    """
    event = {
        "entity": entity,
        "action": action,
        "ts": time.time(),
    }
    if summary:
        event["summary"] = summary

    data = json.dumps(event)
    dead: list[asyncio.Queue] = []

    for q in _subscribers:
        try:
            q.put_nowait(data)
        except asyncio.QueueFull:
            dead.append(q)

    # Evict slow/dead clients
    for q in dead:
        _subscribers.discard(q)


async def event_stream(q: asyncio.Queue) -> AsyncGenerator[str, None]:
    """Yield SSE-formatted messages from a subscriber queue.

    Sends a keepalive comment every 25 seconds to prevent proxy/CDN timeouts.
    """
    try:
        while True:
            try:
                data = await asyncio.wait_for(q.get(), timeout=25)
                yield f"data: {data}\n\n"
            except asyncio.TimeoutError:
                # Keepalive — SSE comment line (ignored by EventSource)
                yield ": keepalive\n\n"
    except asyncio.CancelledError:
        pass
