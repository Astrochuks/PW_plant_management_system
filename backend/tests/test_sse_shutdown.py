"""SSE streams must end the moment the server is told to exit.

Regression guard for 2026-10-11: a uvicorn reload hung forever because the
SSE generator only ever exited when the browser disconnected — and browsers
never do (EventSource auto-reconnects). uvicorn waits for in-flight
requests BEFORE it runs the app's lifespan shutdown, so the fix hooks the
exit signal itself (`hook_shutdown_signals`) and also signals from lifespan
as a belt. These tests pin the generator, the signal chaining, and the
wiring in `app.main.lifespan`. No database needed.
"""

import asyncio
import signal

import pytest

from app.core import events

SHUTDOWN_CHUNK = "event: shutdown\ndata: {}\n\n"


@pytest.fixture(autouse=True)
def _fresh_shutdown_signal():
    events.reset_shutdown_signal()
    yield
    events.reset_shutdown_signal()


async def test_stream_ends_within_two_seconds_of_shutdown():
    q = events.subscribe()
    chunks: list[str] = []

    async def consume():
        async for chunk in events.event_stream(q):
            chunks.append(chunk)

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.05)
    events.broadcast("plants", "update", summary="one event before shutdown")
    await asyncio.sleep(0.05)

    events.signal_shutdown()
    # THE guard: a stream that waits for the browser would time out here.
    await asyncio.wait_for(task, timeout=2)

    assert chunks[0].startswith("data: ") and '"entity": "plants"' in chunks[0]
    assert chunks[-1] == SHUTDOWN_CHUNK
    events.unsubscribe(q)


async def test_keepalive_still_flows_and_shutdown_closes_the_generator(monkeypatch):
    monkeypatch.setattr(events, "KEEPALIVE_SECONDS", 0.05)
    q = events.subscribe()
    gen = events.event_stream(q)

    first = await asyncio.wait_for(gen.__anext__(), timeout=1)
    assert first == ": keepalive\n\n"

    events.signal_shutdown()
    last = await asyncio.wait_for(gen.__anext__(), timeout=1)
    assert last == SHUTDOWN_CHUNK
    with pytest.raises(StopAsyncIteration):
        await asyncio.wait_for(gen.__anext__(), timeout=1)
    events.unsubscribe(q)


async def test_signal_shutdown_is_idempotent():
    events.signal_shutdown()
    events.signal_shutdown()
    q = events.subscribe()
    chunks = [c async for c in events.event_stream(q)]
    assert chunks == [SHUTDOWN_CHUNK]
    events.unsubscribe(q)


async def test_exit_signal_ends_streams_then_reaches_the_server():
    """The real mechanism: SIGTERM arrives → our wrapper sets the event →
    uvicorn's own handler still runs (we must never swallow it)."""
    seen: list[int] = []

    def servers_handler(signum, frame):  # stands in for uvicorn's handle_exit
        seen.append(signum)

    originals = {s: signal.signal(s, servers_handler) for s in events.HOOKED_SIGNALS}
    try:
        previous = events.hook_shutdown_signals(asyncio.get_running_loop())
        assert set(previous) == set(events.HOOKED_SIGNALS)

        q = events.subscribe()
        consumer = asyncio.create_task(
            asyncio.wait_for(_drain(events.event_stream(q)), timeout=2)
        )
        await asyncio.sleep(0.05)

        signal.raise_signal(signal.SIGTERM)
        chunks = await consumer  # would time out if the stream stayed open

        assert chunks == [SHUTDOWN_CHUNK]
        assert seen == [signal.SIGTERM]
        events.unsubscribe(q)

        events.unhook_shutdown_signals(previous)
        assert signal.getsignal(signal.SIGTERM) is servers_handler
    finally:
        for s, h in originals.items():
            signal.signal(s, h)


async def _drain(gen):
    return [c async for c in gen]


async def test_lifespan_hooks_signals_and_signals_before_closing_the_pool(monkeypatch):
    """The wiring: lifespan installs the hook on startup, and on shutdown
    flips the signal before the database pool goes away (streams may still
    be mid-request), then restores the handlers it replaced."""
    from app import main as app_main

    order: list[str] = []

    async def fake_init_pool():
        order.append("init_pool")

    async def fake_metrics_task():
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            order.append("metrics_cancelled")
            raise

    class FakeCollector:
        async def flush(self):
            order.append("flush")

    async def fake_close_pool():
        order.append("close_pool")

    real_signal = events.signal_shutdown

    def spy_signal():
        order.append("signal_shutdown")
        real_signal()

    monkeypatch.setattr(app_main, "_init_pool_with_retry", fake_init_pool)
    monkeypatch.setattr(app_main, "start_metrics_flush_task", fake_metrics_task)
    monkeypatch.setattr(app_main, "get_metrics_collector", lambda: FakeCollector())
    monkeypatch.setattr(app_main, "close_pool", fake_close_pool)
    monkeypatch.setattr(app_main, "signal_shutdown", spy_signal)

    before = signal.getsignal(signal.SIGTERM)
    async with app_main.lifespan(app_main.app):
        order.append("serving")
        assert not events._shutdown_event().is_set()
        assert signal.getsignal(signal.SIGTERM) is not before  # hooked

    assert events._shutdown_event().is_set()
    assert signal.getsignal(signal.SIGTERM) is before  # restored
    assert order.index("signal_shutdown") > order.index("serving")
    assert order.index("signal_shutdown") < order.index("close_pool")
