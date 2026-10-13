"""asyncpg connection pool for direct PostgreSQL access.

Bypasses Supabase PostgREST (REST API gateway) and connects directly to
PostgreSQL through Supavisor (connection pooler on port 6543). This
eliminates ~2-4s of overhead per request from the REST API middleman.

Usage:
    from app.core.pool import fetch, fetchrow, fetchval, execute

    rows = await fetch("SELECT * FROM plants_master WHERE status = $1", "working")
    row = await fetchrow("SELECT * FROM plants_master WHERE id = $1", plant_id)
    count = await fetchval("SELECT count(*) FROM plants_master")
    await execute("UPDATE plants_master SET status = $1 WHERE id = $2", "standby", pid)
"""

import time
import json
import ssl
from collections.abc import AsyncIterator
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

import asyncpg

from app.config import get_settings
from app.monitoring.logging import get_logger

logger = get_logger(__name__)

_pool: asyncpg.Pool | None = None
_pool_recovering = False


async def init_pool() -> None:
    """Create the asyncpg connection pool.

    Called once during application startup (lifespan).
    Uses Supavisor transaction pooler (port 6543) for efficient
    connection multiplexing.
    """
    global _pool
    settings = get_settings()

    async def _init_connection(conn: asyncpg.Connection) -> None:
        """Register JSON codecs so json/jsonb columns auto-decode to Python objects."""
        await conn.set_type_codec(
            "json", encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
        )
        await conn.set_type_codec(
            "jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
        )

    dsn = settings.database_url
    # Determine SSL mode: use simple 'require' for cloud deployments (more compatible)
    # or a custom context for local dev if needed.
    ssl_mode: Any = ssl.create_default_context()
    ssl_mode.check_hostname = False
    ssl_mode.verify_mode = ssl.CERT_NONE

    # If DSN already specifies sslmode, let asyncpg handle it
    if "sslmode=" in dsn:
        ssl_mode = True  # let asyncpg parse sslmode from DSN

    host_info = dsn.split("@")[-1] if "@" in dsn else "unknown"
    logger.info("Connecting to database", host=host_info)

    try:
        _pool = await asyncpg.create_pool(
            dsn=dsn,
            min_size=2,
            max_size=10,
            command_timeout=15,
            timeout=60,  # generous timeout for first connection
            ssl=ssl_mode,
            # Supavisor uses transaction-mode pooling, so we must not use
            # server-side prepared statements (they don't survive across
            # different backend connections).
            statement_cache_size=0,
            init=_init_connection,
        )
    except Exception as e:
        logger.error("Failed to create pool", error=str(e), error_type=type(e).__name__)
        raise

    logger.info(
        "asyncpg pool initialized",
        min_size=2,
        max_size=10,
    )


async def close_pool() -> None:
    """Close the connection pool gracefully.

    Called during application shutdown.
    """
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("asyncpg pool closed")


async def _try_recover_pool() -> None:
    """Attempt to reinitialize the pool in background (called on pool death)."""
    global _pool_recovering
    if _pool_recovering:
        return
    _pool_recovering = True
    try:
        logger.warning("Pool is dead — attempting auto-recovery")
        await init_pool()
        logger.info("Pool auto-recovery succeeded")
    except Exception as e:
        logger.error("Pool auto-recovery failed", error=str(e))
    finally:
        _pool_recovering = False


def get_pool() -> asyncpg.Pool:
    """Return the singleton pool. Raises if not initialized."""
    if _pool is None:
        raise RuntimeError("Database pool not initialized. Call init_pool() first.")
    return _pool


def _record_to_dict(record: asyncpg.Record) -> dict[str, Any]:
    """Convert an asyncpg Record to a plain dict with JSON-safe types."""
    result = dict(record)
    for key, value in result.items():
        if isinstance(value, UUID):
            result[key] = str(value)
        elif isinstance(value, Decimal):
            result[key] = float(value)
        elif isinstance(value, datetime):
            result[key] = value.isoformat()
        elif isinstance(value, date):
            result[key] = value.isoformat()
    return result


class DatabaseUnavailableError(Exception):
    """Raised when the database pool is down. Maps to HTTP 503."""
    pass


SLOW_QUERY_MS = 1000  # one statement slower than this is logged as 'Slow query'


async def _exec_with_recovery(fn_name: str, coro_factory, *, retried: bool = False, sql: str | None = None):
    """Execute a pool operation, triggering recovery on pool death.

    Reads (fetch/fetchrow/fetchval) are retried ONCE on a plain query
    timeout — a 15s command timeout is usually a transient network blip
    to the pooler, not a dead pool, and killing a whole submission for
    it is worse than a second attempt. Writes are never auto-retried
    (a timed-out write may still have landed)."""
    import asyncio

    try:
        pool = get_pool()
    except RuntimeError:
        # Pool is None — trigger recovery and fail fast
        asyncio.create_task(_try_recover_pool())
        raise DatabaseUnavailableError("Database temporarily unavailable — reconnecting")

    started = time.perf_counter()
    try:
        result = await coro_factory(pool)
    except TimeoutError as e:
        if fn_name in ("fetch", "fetchrow", "fetchval") and not retried:
            logger.warning(f"Query timeout in {fn_name} — retrying once", sql=(sql or "")[:120])
            return await _exec_with_recovery(fn_name, coro_factory, retried=True, sql=sql)
        logger.warning(f"Query timeout in {fn_name} (final), triggering pool recovery", error=str(e))
        asyncio.create_task(_try_recover_pool())
        raise DatabaseUnavailableError("Database temporarily unavailable — reconnecting") from e
    except (OSError, asyncpg.InterfaceError, asyncpg.ConnectionDoesNotExistError) as e:
        # Connection-level failure — pool may be dead
        logger.warning(f"Connection error in {fn_name}, triggering pool recovery", error=str(e))
        asyncio.create_task(_try_recover_pool())
        raise DatabaseUnavailableError("Database temporarily unavailable — reconnecting") from e
    elapsed_ms = (time.perf_counter() - started) * 1000
    if elapsed_ms > SLOW_QUERY_MS:
        # grep-able: 'Slow query' — the statement's first line tells you which
        logger.warning("Slow query", fn=fn_name, duration_ms=round(elapsed_ms, 1),
                       sql=" ".join((sql or "").split())[:160])
    return result


async def fetch(sql: str, *args: Any) -> list[dict[str, Any]]:
    """Execute a SELECT and return all rows as list of dicts.

    Args:
        sql: Parameterized SQL query (use $1, $2, ... for params).
        *args: Parameter values.

    Returns:
        List of row dicts. Empty list if no rows.
    """
    rows = await _exec_with_recovery("fetch", lambda pool: pool.fetch(sql, *args), sql=sql)
    return [_record_to_dict(r) for r in rows]


async def stream_rows(
    sql: str, *args: Any, prefetch: int = 200
) -> AsyncIterator[dict[str, Any]]:
    """Stream a large result set row by row, in batches, as dicts.

    Use this instead of `fetch()` for exports and any other result set
    that is large enough for its *transfer* to be slow.

    `fetch()` runs the whole SELECT as ONE command, so `command_timeout`
    (15s) applies to executing it AND shipping every row back. A full
    plants export executes in ~8ms and then takes ~16s to transfer 2MB,
    so it timed out by a second, was retried (another 15s), and finally
    triggered `_try_recover_pool()` — one user pressing Export tore down
    the connection pool for everyone else. The query was never the
    problem; holding one command open for the whole transfer was.

    A cursor turns that single long command into many small FETCHes,
    each its own command, so none of them approaches the timeout and
    memory stays flat regardless of row count.

    Cursors require a transaction, and Supavisor pins its server-side
    connection for the length of one — so reach for this for exports,
    not for ordinary request-path reads.

    Args:
        sql: Parameterized SELECT (use $1, $2, ... for params).
        *args: Parameter values.
        prefetch: Rows per underlying FETCH.

    Yields:
        One row dict at a time, JSON-safe via `_record_to_dict`.

    Raises:
        DatabaseUnavailableError: If the pool is not initialized.
    """
    import asyncio

    try:
        pool = get_pool()
    except RuntimeError:
        asyncio.create_task(_try_recover_pool())
        raise DatabaseUnavailableError(
            "Database temporarily unavailable — reconnecting"
        ) from None

    async with pool.acquire() as conn:
        async with conn.transaction():
            async for record in conn.cursor(sql, *args, prefetch=prefetch):
                yield _record_to_dict(record)


async def fetchrow(sql: str, *args: Any) -> dict[str, Any] | None:
    """Execute a SELECT and return the first row as a dict.

    Args:
        sql: Parameterized SQL query.
        *args: Parameter values.

    Returns:
        Row dict, or None if no rows.
    """
    row = await _exec_with_recovery("fetchrow", lambda pool: pool.fetchrow(sql, *args), sql=sql)
    if row is None:
        return None
    return _record_to_dict(row)


async def fetchval(sql: str, *args: Any) -> Any:
    """Execute a SELECT and return a single scalar value.

    Args:
        sql: Parameterized SQL query.
        *args: Parameter values.

    Returns:
        The first column of the first row, or None.
    """
    return await _exec_with_recovery("fetchval", lambda pool: pool.fetchval(sql, *args), sql=sql)


async def execute(sql: str, *args: Any) -> str:
    """Execute an INSERT/UPDATE/DELETE and return the status string.

    Args:
        sql: Parameterized SQL statement.
        *args: Parameter values.

    Returns:
        PostgreSQL status string (e.g. "UPDATE 1", "INSERT 0 1").
    """
    return await _exec_with_recovery("execute", lambda pool: pool.execute(sql, *args), sql=sql)


async def fetch_insert(sql: str, *args: Any) -> dict[str, Any] | None:
    """Execute an INSERT ... RETURNING and return the inserted row.

    Args:
        sql: INSERT statement with RETURNING clause.
        *args: Parameter values.

    Returns:
        Inserted row as dict, or None.
    """
    return await fetchrow(sql, *args)


async def fetch_update(sql: str, *args: Any) -> dict[str, Any] | None:
    """Execute an UPDATE ... RETURNING and return the updated row.

    Args:
        sql: UPDATE statement with RETURNING clause.
        *args: Parameter values.

    Returns:
        Updated row as dict, or None.
    """
    return await fetchrow(sql, *args)


async def executemany(sql: str, args_list: list[tuple]) -> None:
    """Execute the same statement with multiple sets of parameters.

    Useful for batch inserts.

    Args:
        sql: Parameterized SQL statement.
        args_list: List of parameter tuples.
    """
    await _exec_with_recovery("executemany", lambda pool: pool.executemany(sql, args_list), sql=sql)


async def fetch_json_rpc(func_name: str, *args: Any) -> Any:
    """Call a PostgreSQL function that returns JSON/JSONB.

    Most of our RPCs return a single JSON object or array.

    Args:
        func_name: The function name (e.g. 'get_dashboard_plant_stats').
        *args: Function arguments in order.

    Returns:
        Parsed JSON (dict, list, or scalar).
    """
    # Build parameter placeholders: $1, $2, ...
    placeholders = ", ".join(f"${i+1}" for i in range(len(args)))
    sql = f"SELECT * FROM {func_name}({placeholders})"

    row = await _exec_with_recovery("fetch_json_rpc", lambda pool: pool.fetchrow(sql, *args), sql=sql)
    if row is None:
        return None

    # If the function returns a single column, return just that value
    values = list(row.values())
    if len(values) == 1:
        val = values[0]
        # asyncpg auto-decodes jsonb to Python objects
        if isinstance(val, str):
            try:
                return json.loads(val)
            except (json.JSONDecodeError, TypeError):
                return val
        return val

    # Multiple columns → return as dict
    return _record_to_dict(row)
