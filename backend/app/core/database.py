"""Supabase database client configuration.

Provides both anonymous (user-context) and admin (service role) clients.
"""

from functools import lru_cache
from typing import Any

from httpx import Client as HttpxClient, Timeout
from supabase import Client, create_client
from supabase.lib.client_options import SyncClientOptions

from app.config import get_settings


def _build_timeout() -> Timeout:
    """Build httpx Timeout from settings."""
    settings = get_settings()
    return Timeout(
        connect=5.0,  # TCP + SSL handshake
        read=float(settings.supabase_postgrest_timeout),
        write=float(settings.supabase_postgrest_timeout),
        pool=5.0,
    )


@lru_cache
def _shared_httpx_client() -> HttpxClient:
    """Shared httpx client with connection pooling.

    A single pool reuses TCP+TLS connections across requests,
    avoiding ~200-400ms handshake overhead per request.
    Thread-safe: httpx.Client supports concurrent requests.

    HTTP/2 multiplexing allows all 3 parallel login calls to
    share a single TCP connection instead of opening 3 separate ones.
    """
    return HttpxClient(
        timeout=_build_timeout(),
        http2=True,
    )


def _client_options(*, shared_pool: bool = True) -> SyncClientOptions:
    """Build SyncClientOptions with configured timeouts.

    Args:
        shared_pool: Use the shared httpx connection pool (default True).
            Set False only if the caller needs an isolated transport.
    """
    settings = get_settings()
    return SyncClientOptions(
        postgrest_client_timeout=settings.supabase_postgrest_timeout,
        storage_client_timeout=settings.supabase_storage_timeout,
        function_client_timeout=settings.supabase_function_timeout,
        httpx_client=_shared_httpx_client() if shared_pool else HttpxClient(timeout=_build_timeout()),
    )


@lru_cache
def get_supabase_client() -> Client:
    """Get cached Supabase client with anonymous key.

    WARNING: This is a singleton. Do NOT use for operations that mutate
    auth state (sign_in, sign_out, refresh_session, update_user).
    Use create_auth_client() for those operations.

    Safe for: table queries, get_user(token) validation.
    """
    settings = get_settings()
    return create_client(
        settings.supabase_url,
        settings.supabase_anon_key,
        options=_client_options(),
    )


@lru_cache
def get_supabase_admin_client() -> Client:
    """Get Supabase client with service role key.

    This client bypasses RLS policies.
    Use only for admin operations, background jobs, and system tasks.
    """
    settings = get_settings()
    return create_client(
        settings.supabase_url,
        settings.supabase_service_role_key,
        options=_client_options(),
    )


def create_auth_client() -> Client:
    """Create a fresh Supabase client for auth operations.

    NOT cached — each call returns a new instance. Use this for any
    operation that mutates the client's auth state:
    - sign_in_with_password (sets session)
    - refresh_session (changes session)
    - sign_out (clears session)

    This prevents race conditions when multiple users authenticate
    concurrently on the same server.
    """
    settings = get_settings()
    return create_client(
        settings.supabase_url,
        settings.supabase_anon_key,
        options=_client_options(),
    )


class DatabaseClient:
    """High-level database client wrapper with error handling and logging."""

    def __init__(self, client: Client):
        self.client = client

    async def execute_query(
        self,
        table: str,
        operation: str,
        **kwargs: Any,
    ) -> Any:
        """Execute a database query with standard error handling.

        Args:
            table: Table name to query.
            operation: Operation type (select, insert, update, delete, upsert).
            **kwargs: Additional arguments for the query.

        Returns:
            Query result data.

        Raises:
            DatabaseError: If the query fails.
        """
        from app.core.exceptions import DatabaseError, NotFoundError, ConflictError

        try:
            query = self.client.table(table)

            if operation == "select":
                query = query.select(kwargs.get("columns", "*"))
                if filters := kwargs.get("filters"):
                    for key, value in filters.items():
                        query = query.eq(key, value)
                if order := kwargs.get("order"):
                    query = query.order(order, desc=kwargs.get("desc", False))
                if limit := kwargs.get("limit"):
                    query = query.limit(limit)
                if offset := kwargs.get("offset"):
                    query = query.range(offset, offset + kwargs.get("limit", 20) - 1)

            elif operation == "insert":
                query = query.insert(kwargs.get("data", {}))

            elif operation == "update":
                query = query.update(kwargs.get("data", {}))
                if filters := kwargs.get("filters"):
                    for key, value in filters.items():
                        query = query.eq(key, value)

            elif operation == "delete":
                query = query.delete()
                if filters := kwargs.get("filters"):
                    for key, value in filters.items():
                        query = query.eq(key, value)

            elif operation == "upsert":
                query = query.upsert(
                    kwargs.get("data", {}),
                    on_conflict=kwargs.get("on_conflict", "id"),
                )

            result = query.execute()
            return result.data

        except Exception as e:
            error_message = str(e)

            # Handle specific PostgreSQL errors
            if "duplicate key" in error_message.lower():
                raise ConflictError("A record with this identifier already exists")
            if "foreign key" in error_message.lower():
                raise DatabaseError(
                    "Referenced record does not exist",
                    operation=operation,
                    retryable=False,
                )
            if "not found" in error_message.lower() or "0 rows" in error_message.lower():
                raise NotFoundError(table)

            # Generic database error
            raise DatabaseError(
                f"Database operation failed: {error_message}",
                operation=operation,
                retryable=True,
            )

    async def call_rpc(self, function_name: str, params: dict[str, Any] | None = None) -> Any:
        """Call a PostgreSQL RPC function.

        Args:
            function_name: Name of the function to call.
            params: Parameters to pass to the function.

        Returns:
            Function result.
        """
        from app.core.exceptions import DatabaseError

        try:
            result = self.client.rpc(function_name, params or {}).execute()
            return result.data
        except Exception as e:
            raise DatabaseError(
                f"RPC call to {function_name} failed: {str(e)}",
                operation=f"rpc:{function_name}",
            )
