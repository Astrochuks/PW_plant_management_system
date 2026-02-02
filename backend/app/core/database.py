"""Supabase database client configuration.

Provides both anonymous (user-context) and admin (service role) clients.
"""

from functools import lru_cache
from typing import Any

from supabase import Client, create_client

from app.config import get_settings


@lru_cache
def get_supabase_client() -> Client:
    """Get Supabase client with anonymous key.

    This client respects Row Level Security (RLS) policies.
    Use for user-authenticated requests.
    """
    settings = get_settings()
    return create_client(
        settings.supabase_url,
        settings.supabase_anon_key,
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
    )


def get_authenticated_client(access_token: str) -> Client:
    """Get Supabase client authenticated with user's access token.

    This client will execute queries in the context of the authenticated user,
    respecting RLS policies.

    Args:
        access_token: The user's JWT access token from Supabase Auth.

    Returns:
        Authenticated Supabase client.
    """
    settings = get_settings()
    client = create_client(
        settings.supabase_url,
        settings.supabase_anon_key,
    )
    client.auth.set_session(access_token, "")
    return client


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
