"""R's API router. P's main.py includes it and overrides get_user_id with current_user (§4.1).

Endpoints R owns (BUILD_TASKS.md §4.4), added by later tasks:
    POST  /api/grove/grow            (plain JSON, or NDJSON with ?stream=1)   R-8, R-9
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

import json
import logging
from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, StreamingResponse
from limits import parse
from pydantic import Field
from slowapi import Limiter

from . import claims, db, memory
from .adapters.auth import get_user_id
from .aoai import AzureOpenAIClient
from .cluster import MAX_TABS
from .grove import GrowRun
from .persist import budget_exceeded, last_grove, persist_run, usage_today
from .problems import ProblemError
from .schemas.claims import AssignRequest, AssignResponse, ClaimPatchRequest, NoteCreateRequest, NoteCreateResponse
from .schemas.common import Strict, TabRef
from .schemas.grove import Tree
from .settings import get_settings

log = logging.getLogger("tabforest.engine.routes")
router = APIRouter(prefix="/api")

# R's own slowapi limiter (§4.9), keyed by the token-derived user id inside the handler.
limiter = Limiter(key_func=lambda request: "unused", strategy="moving-window", storage_uri="memory://")
GROW_LIMIT = parse("10/minute")


class SnapshotTab(Strict):
    """One open tab, BUILD_TASKS.md §4.2 (contracts/snapshot.example.json)."""

    tab_ref: TabRef
    domain: str = Field(max_length=253)
    title: str = Field(max_length=300)
    opener_tab_ref: TabRef | None = None
    opened_at: datetime
    active: bool = False
    pinned: bool = False
    dup_key: str | None = Field(default=None, max_length=64)
    search_query: str | None = Field(default=None, max_length=300)


class GrowRequest(Strict):
    open_tabs: list[SnapshotTab] = Field(max_length=MAX_TABS)
    hollow_count: int = Field(default=0, ge=0)
    # Replays the demo fixtures at their own time; honored only when AUTH_MODE=dev, else server time.
    snapshot_at: datetime | None = None


def _check_limit(user_id: UUID, bucket: str = "grow") -> None:
    if not limiter.limiter.hit(GROW_LIMIT, bucket, str(user_id)):
        reset_at, _ = limiter.limiter.get_window_stats(GROW_LIMIT, bucket, str(user_id))
        retry = max(1, int(reset_at - datetime.now().timestamp()) + 1)
        raise ProblemError(429, "Too Many Requests", f"{bucket.capitalize()} is limited to 10 requests per minute",
                           headers={"Retry-After": str(retry)})


_check_grow_limit = _check_limit


@router.post("/grove/grow", response_model=None)
async def grow(body: GrowRequest, user_id: UUID = Depends(get_user_id),
               stream: Annotated[int, Query(ge=0, le=1)] = 0) -> Any:
    """Analyze the open-tab snapshot. Plain JSON, or NDJSON lines with ?stream=1 (§4.7)."""
    _check_grow_limit(user_id)
    settings = get_settings()
    pool = await db.get_pool()
    over = budget_exceeded(*await usage_today(pool, user_id))
    if over:
        raise ProblemError(429, "Too Many Requests", over)
    snapshot_at = body.snapshot_at if settings.auth_mode == "dev" else None
    tabs = [t.model_dump(mode="json") for t in body.open_tabs]
    client = AzureOpenAIClient()
    run = GrowRun(user_id, tabs, body.hollow_count, pool=pool, client=client, snapshot_at=snapshot_at,
                  persist=persist_run, model_name=settings.azure_openai_chat_deployment)

    async def lines():
        try:
            async for line in run.stream():
                yield json.dumps(line, ensure_ascii=False) + "\n"
        finally:
            await client.aclose()

    if stream:
        return StreamingResponse(lines(), media_type="application/x-ndjson")
    try:
        async for _ in run.stream():
            pass
    finally:
        await client.aclose()
    return JSONResponse(run.response)


@router.get("/grove")
async def get_grove(user_id: UUID = Depends(get_user_id)) -> Any:
    """The user's last stored grove (analysis_runs.response)."""
    pool = await db.get_pool()
    if pool is None:
        raise ProblemError(503, "Service Unavailable", "Memory is not configured", headers={"Retry-After": "30"})
    response = await last_grove(pool, user_id)
    if response is None:
        raise ProblemError(404, "Not Found", "No grove yet; grow one first")
    return JSONResponse(response)


@router.get("/memory/search")
async def memory_search(q: Annotated[str, Query(min_length=1, max_length=300)],
                        user_id: UUID = Depends(get_user_id)) -> Any:
    """Past research of THIS user related to q (R-12). Not found is a 200 with found=false, never a 404."""
    _check_limit(user_id, "memory")
    pool = await db.get_pool()
    if pool is None:
        raise ProblemError(503, "Service Unavailable", "Memory is not configured", headers={"Retry-After": "30"})
    client = AzureOpenAIClient()
    try:
        return JSONResponse(memory.payload(await memory.search(pool, user_id, q.strip(), client=client)))
    finally:
        await client.aclose()


@router.post("/_memory/run", include_in_schema=False)
async def memory_run(user_id: UUID = Depends(get_user_id)) -> Any:
    """Dev only: one memory pass now for the caller's projects (the background loop covers everyone, every 5 minutes)."""
    if get_settings().auth_mode != "dev":
        raise ProblemError(404, "Not Found", "Not found")
    pool = await db.get_pool()
    if pool is None:
        raise ProblemError(503, "Service Unavailable", "Memory is not configured", headers={"Retry-After": "30"})
    done = await memory.run_memory_pass(pool, user_id=user_id)
    return {"locked_out": done.locked_out, "checked": done.checked, "written": len(done.written)}


@router.get("/_whoami", include_in_schema=False)
async def whoami(user_id: UUID = Depends(get_user_id)) -> dict[str, str]:
    """Dev-only identity echo; 404 unless AUTH_MODE=dev."""
    if get_settings().auth_mode != "dev":
        raise ProblemError(404, "Not Found", "Not found")
    return {"user_id": str(user_id)}


@router.patch("/claims/{claim_id}", response_model=None)
async def patch_claim(claim_id: str, body: ClaimPatchRequest, user_id: UUID = Depends(get_user_id)) -> Any:
    """Confirm, edit, dismiss or resolve a claim (R-10)."""
    return JSONResponse(await claims.patch_claim(await db.get_pool(), user_id, claim_id, body))


@router.post("/tabs/{tab_ref}/assign", response_model=None)
async def assign_tab(tab_ref: str, body: AssignRequest, user_id: UUID = Depends(get_user_id)) -> Any:
    """Move a tab to another tree, or to a new one (pinned: the next grow keeps it there)."""
    result, status = await claims.assign_tab(await db.get_pool(), user_id, tab_ref, body)
    return JSONResponse(AssignResponse.model_validate(result).model_dump(mode="json"), status_code=status)


@router.post("/notes", response_model=None)
async def create_note(body: NoteCreateRequest, user_id: UUID = Depends(get_user_id)) -> Any:
    """"Clear the fog": name a goal, record a decision or a note."""
    result = await claims.create_note(await db.get_pool(), user_id, body)
    return JSONResponse(NoteCreateResponse.model_validate(result).model_dump(mode="json"), status_code=201)


@router.post("/projects/{project_id}/analyze", response_model=None)
async def analyze_project(project_id: str, user_id: UUID = Depends(get_user_id)) -> Any:
    """Re-run inference for one project's current tabs; returns its tree."""
    _check_limit(user_id, "analyze")
    client = AzureOpenAIClient()
    try:
        tree = await claims.analyze_project(await db.get_pool(), client, user_id, project_id,
                                            model_name=get_settings().azure_openai_chat_deployment)
    finally:
        await client.aclose()
    return JSONResponse(Tree.model_validate(tree).model_dump(mode="json"))


# R-13: prune suggestions live in prune.py; included last so this module stays the single router.
from .prune import router as _prune_router  # noqa: E402

router.include_router(_prune_router)

# R-11: Work Context lives in work_context.py.
from .work_context import router as _work_context_router  # noqa: E402

router.include_router(_work_context_router)
