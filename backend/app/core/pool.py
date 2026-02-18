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

import json
import ssl
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

import asyncpg

from app.config import get_settings
from app.monitoring.logging import get_logger

logger = get_logger(__name__)

_pool: asyncpg.Pool | None = None


async def init_pool() -> None:
    """Create the asyncpg connection pool.

    Called once during application startup (lifespan).
    Uses Supavisor transaction pooler (port 6543) for efficient
    connection multiplexing.
    """
    global _pool
    settings = get_settings()

    # Supavisor requires SSL
    ssl_ctx = ssl.create_default_context()
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    async def _init_connection(conn: asyncpg.Connection) -> None:
        """Register JSON codecs so json/jsonb columns auto-decode to Python objects."""
        await conn.set_type_codec(
            "json", encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
        )
        await conn.set_type_codec(
            "jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
        )

    _pool = await asyncpg.create_pool(
        dsn=settings.database_url,
        min_size=2,
        max_size=10,
        command_timeout=15,
        ssl=ssl_ctx,
        # Supavisor uses transaction-mode pooling, so we must not use
        # server-side prepared statements (they don't survive across
        # different backend connections).
        statement_cache_size=0,
        init=_init_connection,
    )

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


async def fetch(sql: str, *args: Any) -> list[dict[str, Any]]:
    """Execute a SELECT and return all rows as list of dicts.

    Args:
        sql: Parameterized SQL query (use $1, $2, ... for params).
        *args: Parameter values.

    Returns:
        List of row dicts. Empty list if no rows.
    """
    pool = get_pool()
    rows = await pool.fetch(sql, *args)
    return [_record_to_dict(r) for r in rows]


async def fetchrow(sql: str, *args: Any) -> dict[str, Any] | None:
    """Execute a SELECT and return the first row as a dict.

    Args:
        sql: Parameterized SQL query.
        *args: Parameter values.

    Returns:
        Row dict, or None if no rows.
    """
    pool = get_pool()
    row = await pool.fetchrow(sql, *args)
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
    pool = get_pool()
    return await pool.fetchval(sql, *args)


async def execute(sql: str, *args: Any) -> str:
    """Execute an INSERT/UPDATE/DELETE and return the status string.

    Args:
        sql: Parameterized SQL statement.
        *args: Parameter values.

    Returns:
        PostgreSQL status string (e.g. "UPDATE 1", "INSERT 0 1").
    """
    pool = get_pool()
    return await pool.execute(sql, *args)


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
    pool = get_pool()
    await pool.executemany(sql, args_list)


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

    pool = get_pool()
    row = await pool.fetchrow(sql, *args)
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
