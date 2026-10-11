"""Which projects may this user see? (PRD v2 §2, §3.5 — roles v3)

One rule, applied in SQL, never in the client:

  admin, plant_officer          unrestricted (scope not consulted)
  project_manager, scope 'all'  unrestricted — the General PM
  project_manager, 'assigned'   only projects in user_project_assignments
  site_engineer                 only projects in user_project_assignments
                                (their scope is always 'assigned')

`visible_project_ids()` returns None for "unrestricted" and the list of
UUID strings otherwise; `scope_condition()` turns that into a SQL
fragment; `project_scope_guard` is a router-level dependency that turns an
out-of-scope `{project_id}` into a 404 — existence is not leaked.
"""

from typing import Annotated, Any

from fastapi import Depends, Request

from app.core.exceptions import NotFoundError
from app.core.pool import fetch
from app.core.security import CurrentUser, get_current_user


def is_scoped(user: CurrentUser) -> bool:
    """True when the user may see only their assigned projects."""
    if user.is_admin or user.is_plant_officer:
        return False
    if user.is_site_engineer:
        return True
    return user.project_scope == "assigned"


async def visible_project_ids(user: CurrentUser) -> list[str] | None:
    """None = unrestricted; otherwise the (possibly empty) list of ids."""
    if not is_scoped(user):
        return None
    rows = await fetch(
        """SELECT project_id FROM user_project_assignments
            WHERE user_id = $1::uuid AND ended_at IS NULL""",
        user.id,
    )
    return [str(r["project_id"]) for r in rows]


def scope_condition(ids: list[str] | None, column: str, params: list[Any]) -> str:
    """Append the id list to `params` and return a WHERE fragment.

    Unrestricted → 'TRUE' (nothing appended). An empty list → 'FALSE', so
    a scoped user with no assignments sees nothing rather than everything.
    """
    if ids is None:
        return "TRUE"
    if not ids:
        return "FALSE"
    params.append(ids)
    return f"{column} = ANY(${len(params)}::uuid[])"


async def project_scope_guard(
    request: Request,
    current_user: Annotated[CurrentUser, Depends(get_current_user)],
) -> None:
    """Router-level dependency: a scoped user asking for a project outside
    their assignments gets 404, whatever the route."""
    project_id = request.path_params.get("project_id")
    if not project_id:
        return
    ids = await visible_project_ids(current_user)
    if ids is not None and str(project_id) not in ids:
        raise NotFoundError("Project", str(project_id))
