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
import signal
import time
from typing import AsyncGenerator

from app.core import cache
from app.monitoring.logging import get_logger

logger = get_logger(__name__)

# All connected client queues
_subscribers: set[asyncio.Queue] = set()

# Set once the application begins shutting down. Every open SSE stream
# waits on this alongside its queue, so a graceful shutdown (uvicorn
# reload, SIGTERM on deploy) completes in milliseconds instead of waiting
# for browsers — which auto-reconnect and therefore never hang up — to
# close connections that are immortal by design.
_shutting_down: asyncio.Event | None = None

# How long a stream waits for an event before emitting a keepalive comment
# (proxies and CDNs drop idle connections; 25s stays under common limits).
KEEPALIVE_SECONDS = 25


def _shutdown_event() -> asyncio.Event:
    """Lazily create the event on the running loop (module import happens
    before any loop exists, and tests run several loops)."""
    global _shutting_down
    if _shutting_down is None:
        _shutting_down = asyncio.Event()
    return _shutting_down


def signal_shutdown() -> None:
    """Tell every open SSE stream to finish. Called first thing in the
    application's shutdown sequence; idempotent."""
    _shutdown_event().set()
    logger.info("SSE streams told to close", total=len(_subscribers))


def reset_shutdown_signal() -> None:
    """Re-arm after a shutdown — only tests need this (the process exits
    in real life)."""
    global _shutting_down
    _shutting_down = None


# ── Hooking the server's own exit signals ───────────────────────────────
# uvicorn's shutdown order is: receive SIGTERM/SIGINT → stop accepting →
# WAIT for in-flight requests (up to --timeout-graceful-shutdown) → only
# THEN run the application's lifespan shutdown. Signalling the streams
# from lifespan is therefore too late by construction: the wait has
# already happened. So at startup we wrap the signal handlers uvicorn has
# installed (it uses plain signal.signal, see uvicorn.server.Server
# .capture_signals) and set our event first, then defer to uvicorn's.
HOOKED_SIGNALS = (signal.SIGINT, signal.SIGTERM)


def hook_shutdown_signals(loop: asyncio.AbstractEventLoop) -> dict[int, object]:
    """Install the chaining handlers. Returns what they replaced so
    `unhook_shutdown_signals` can restore it. A no-op (empty dict) off the
    main thread, where Python forbids signal handlers."""
    previous: dict[int, object] = {}

    def make_handler(sig: int):
        def handler(signum, frame):
            loop.call_soon_threadsafe(signal_shutdown)
            prev = previous.get(signum)
            if callable(prev):
                prev(signum, frame)
        return handler

    for sig in HOOKED_SIGNALS:
        try:
            previous[sig] = signal.signal(sig, make_handler(sig))
        except ValueError:  # not the main thread
            unhook_shutdown_signals(previous)
            return {}
    return previous


def unhook_shutdown_signals(previous: dict[int, object]) -> None:
    """Put back whatever handlers were there before `hook_shutdown_signals`."""
    for sig, handler in previous.items():
        try:
            signal.signal(sig, handler)  # type: ignore[arg-type]
        except (ValueError, TypeError):
            pass


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
    # Invalidate backend caches that depend on this entity
    if entity in ("plants", "transfers", "uploads"):
        cache.invalidate("locations:list")

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

    Sends a keepalive comment every KEEPALIVE_SECONDS to prevent proxy/CDN
    timeouts. Ends on its own when the application shuts down: it emits a
    final `event: shutdown` so the browser's EventSource reconnects to the
    new process straight away, then returns.
    """
    stop = _shutdown_event()
    getter: asyncio.Future | None = None
    stopper: asyncio.Future | None = None
    try:
        while not stop.is_set():
            getter = asyncio.ensure_future(q.get())
            stopper = asyncio.ensure_future(stop.wait())
            done, _pending = await asyncio.wait(
                {getter, stopper},
                timeout=KEEPALIVE_SECONDS,
                return_when=asyncio.FIRST_COMPLETED,
            )
            stopper.cancel()
            if getter in done:
                yield f"data: {getter.result()}\n\n"
                continue
            # Shutdown or keepalive timeout: retire the pending get().
            # (Queue.get only dequeues after its await returns, so cancelling
            # here can never drop an event.)
            getter.cancel()
            if not done:
                # Keepalive — SSE comment line (ignored by EventSource)
                yield ": keepalive\n\n"
        yield "event: shutdown\ndata: {}\n\n"
    except asyncio.CancelledError:
        pass
    finally:
        # a client that drops mid-wait leaves the get() pending; cancel it so
        # the loop never logs "Task was destroyed but it is pending"
        for fut in (getter, stopper):
            if fut is not None and not fut.done():
                fut.cancel()
