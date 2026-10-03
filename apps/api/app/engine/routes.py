"""R's API router. P's main.py includes it and overrides get_user_id with current_user (§4.1).

Endpoints R owns (BUILD_TASKS.md §4.4), added by later tasks:
    POST  /api/grove/grow            (plain JSON, or NDJSON with ?stream=1)   R-8
    GET   /api/grove                                                           R-8
    POST  /api/projects/{id}/analyze                                           R-10
    PATCH /api/claims/{id}                                                     R-10
    POST  /api/tabs/{tab_ref}/assign                                           R-10
    POST  /api/notes                                                           R-10
    POST  /api/work-context/analyze  (application/json)                        R-11
    POST  /api/work-context/upload   (multipart/form-data)                     R-11
    GET   /api/memory/search                                                   R-12
    POST  /api/tabs/prune-suggestions                                          R-13
"""

from uuid import UUID

from fastapi import APIRouter, Depends

from .adapters.auth import get_user_id
from .problems import ProblemError
from .settings import get_settings

router = APIRouter(prefix="/api")


@router.get("/_whoami", include_in_schema=False)
async def whoami(user_id: UUID = Depends(get_user_id)) -> dict[str, str]:
    """Dev-only identity echo; 404 unless AUTH_MODE=dev."""
    if get_settings().auth_mode != "dev":
        raise ProblemError(404, "Not Found", "Not found")
    return {"user_id": str(user_id)}
