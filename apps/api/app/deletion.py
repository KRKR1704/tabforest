"""P-11: DELETE /api/projects/{id} ("Delete forest") and DELETE /api/me ("Delete all"), SPEC §11.3, §26.

Shapes follow contracts/privacy.example.json (delete_forest) and contracts/me.example.json (delete_account).
A project that does not exist or belongs to someone else is a 404 either way. The extension then sends WIPE_LOCAL;
the next GET /api/me provisions a fresh account.
"""

from __future__ import annotations

import logging
import re
from typing import Any
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends

from app.auth import current_user
from app.db import deletion_repository as store
from app.errors import Problem
from app.routes import db_pool

log = logging.getLogger("tabforest.deletion")
router = APIRouter(prefix="/api", tags=["deletion"])

_PROJECT_ID = re.compile(r"^p_([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$")


def parse_project_id(value: str) -> UUID | None:
    match = _PROJECT_ID.match(value)
    return UUID(match.group(1)) if match else None


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str, user_id: UUID = Depends(current_user),
                         pool: asyncpg.Pool = Depends(db_pool)) -> dict[str, Any]:
    parsed = parse_project_id(project_id)
    counts = None
    if parsed is not None:
        async with pool.acquire() as conn:
            counts = await store.delete_project(user_id, conn, parsed)
    if counts is None:
        raise Problem(404, "Project not found")
    return {"project_id": f"p_{parsed}", "deleted": counts, "total": store.total(counts)}


@router.delete("/me")
async def delete_me(user_id: UUID = Depends(current_user), pool: asyncpg.Pool = Depends(db_pool)) -> dict[str, Any]:
    async with pool.acquire() as conn:
        counts, lo, hi = await store.delete_me(user_id, conn)
        await store.refresh_aggregates(conn, lo, hi)
    log.info("account deleted: %d rows", store.total(counts))  # counts only; never titles or text
    return {"deleted": counts, "total": store.total(counts)}
