"""Server-Sent Events endpoint for real-time data sync.

Any authenticated user can connect. When a mutation happens anywhere in the
system, all connected clients receive an event so they can refresh their
local data without a full page reload.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse

from app.core.events import subscribe, unsubscribe, event_stream
from app.core.security import CurrentUser, _verify_token, _get_user_data
from app.core.exceptions import AuthenticationError

router = APIRouter()


async def _authenticate_sse(token: str = Query(..., description="JWT access token")) -> CurrentUser:
    """Authenticate SSE connections via query-param token.

    EventSource API doesn't support custom headers, so we accept
    the JWT as a query parameter instead of Authorization header.
    """
    try:
        user_id = _verify_token(token)
        user = await _get_user_data(user_id)
        if not user.get("is_active", False):
            raise AuthenticationError("User account is deactivated")
        location_id = user.get("location_id")
        return CurrentUser(
            id=user["id"],
            email=user["email"],
            role=user["role"],
            full_name=user.get("full_name"),
            is_active=user.get("is_active", True),
            location_id=str(location_id) if location_id else None,
        )
    except Exception:
        raise AuthenticationError("Invalid or expired token")


@router.get("/stream")
async def sse_stream(
    request: Request,
    current_user: Annotated[CurrentUser, Depends(_authenticate_sse)],
) -> StreamingResponse:
    """SSE endpoint — streams real-time invalidation events to the client.

    Events are JSON objects: {"entity": "projects", "action": "import", "ts": ...}
    The frontend uses these to invalidate React Query caches.

    Pass JWT as ?token=... query parameter (EventSource can't set headers).
    """
    q = subscribe()

    async def generate():
        try:
            async for chunk in event_stream(q):
                # Check if client disconnected
                if await request.is_disconnected():
                    break
                yield chunk
        finally:
            unsubscribe(q)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )
