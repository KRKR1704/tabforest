"""P-9: saved contexts (contracts/saved-context.example.json).

POST /api/projects/{id}/save-context stores the card the grove page shows plus the stripped URLs,
as sent, with the project's totals at save time. GET /api/contexts lists them; POST
/api/contexts/{id}/resume returns the card with live totals across all of the project's sessions
and the tabs ranked by R's current importance. When a project's events have aged out of retention
the recorded totals are returned instead, with totals_as_of = the save time.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, Request

from app import ids
from app.adapters import intents
from app.auth import current_user
from app.clock import now as clock_now
from app.db import repository as repo
from app.errors import not_found
from app.routes import db_pool
from app.schemas import (
    ContextCreated,
    ContextList,
    ContextRow,
    ResumeCard,
    ResumeOtherTab,
    ResumeTab,
    SaveContextIn,
    iso,
)

router = APIRouter(prefix="/api", tags=["contexts"])

RESTORE_OPTIONS = ["important", "all", "summary"]
Activity = tuple[int, int, datetime | None]   # active_ms, session_count, last_active_at


async def _live(user_id: UUID, conn: asyncpg.Connection, project_ids: list[UUID],
                now: datetime) -> dict[UUID, Activity]:
    tabs = await intents.project_tab_refs(user_id, conn, project_ids)
    return {pid: await repo.project_activity(user_id, conn, tabs.get(pid, []), now) for pid in project_ids}


def _totals(row: asyncpg.Record, live: Activity | None) -> tuple[int, int, str | None, str | None]:
    """(active_ms, session_count, last_active_at, totals_as_of): live while the project still has
    stored events, else the totals recorded at save time."""
    if live and live[1]:
        return live[0], live[1], iso(live[2]), None
    recorded = row["snapshot"].get("totals") or {}
    return (recorded.get("active_ms", 0), recorded.get("session_count", 0), recorded.get("last_active_at"),
            iso(row["saved_at"]))


def _text(card: dict[str, Any] | None, key: str) -> str | None:
    claim = (card or {}).get(key)
    return claim.get("text") if isinstance(claim, dict) else None


@router.post("/projects/{project_id}/save-context", status_code=201, response_model=ContextCreated)
async def save_context(request: Request, project_id: str, body: SaveContextIn,
                       user_id: UUID = Depends(current_user), now: datetime = Depends(clock_now)) -> ContextCreated:
    pid = ids.parse(ids.PROJECT, project_id)
    pool = await db_pool(request)
    async with pool.acquire() as conn:
        project = await intents.project(user_id, conn, pid) if pid else None
        if project is None:
            raise not_found("Project not found")
        active, sessions, last = (await _live(user_id, conn, [project.id], now))[project.id]
        snapshot = {"project_name": project.name, "card": body.card,
                    "tabs": [t.model_dump(mode="json") for t in body.tabs],
                    "totals": {"active_ms": active, "session_count": sessions, "last_active_at": iso(last)}}
        row = await repo.insert_saved_context(user_id, conn, project_id=project.id, title=body.title,
                                              kind=body.kind, snapshot=snapshot, saved_at=now)
    return ContextCreated(id=ids.out(ids.CONTEXT, row["id"]), project_id=ids.out(ids.PROJECT, project.id),
                          kind=row["kind"], title=row["title"], saved_at=iso(row["saved_at"]),
                          important_tab_count=sum(t.important for t in body.tabs), total_tab_count=len(body.tabs))


@router.get("/contexts", response_model=ContextList)
async def list_contexts(request: Request, user_id: UUID = Depends(current_user),
                        now: datetime = Depends(clock_now)) -> ContextList:
    """The user's saved contexts, newest first."""
    pool = await db_pool(request)
    async with pool.acquire() as conn:
        rows = await repo.list_saved_contexts(user_id, conn)
        pids = sorted({r["project_id"] for r in rows if r["project_id"]}, key=str)
        names = await intents.project_names(user_id, conn, pids)
        live = await _live(user_id, conn, pids, now)
        open_questions = await intents.open_question_counts(user_id, conn, pids)
    out = []
    for r in rows:
        snap, pid = r["snapshot"], r["project_id"]
        active, sessions, last, as_of = _totals(r, live.get(pid))
        tabs = snap.get("tabs", [])
        out.append(ContextRow(
            id=ids.out(ids.CONTEXT, r["id"]), project_id=ids.out(ids.PROJECT, pid),
            project_name=names.get(pid, snap.get("project_name")), kind=r["kind"], title=r["title"],
            saved_at=iso(r["saved_at"]), last_resumed_at=iso(r["last_resumed_at"]), last_active_at=last,
            active_ms=active, session_count=sessions, totals_as_of=as_of,
            open_question_count=open_questions.get(pid, 0),
            important_tab_count=sum(1 for t in tabs if t.get("important")), total_tab_count=len(tabs),
            goal_summary=_text(snap.get("card"), "goal"), next_action=_text(snap.get("card"), "next_action")))
    return ContextList(contexts=out)


@router.post("/contexts/{context_id}/resume", response_model=ResumeCard)
async def resume_context(request: Request, context_id: str, user_id: UUID = Depends(current_user),
                         now: datetime = Depends(clock_now)) -> ResumeCard:
    """The resume card; another user's context is 404."""
    cid = ids.parse(ids.CONTEXT, context_id)
    pool = await db_pool(request)
    async with pool.acquire() as conn:
        row = await repo.resume_saved_context(user_id, conn, cid, now) if cid else None
        if row is None:
            raise not_found("Saved context not found")
        pid = row["project_id"]
        project = await intents.project(user_id, conn, pid) if pid else None
        importance: dict[str, float] = {}
        if project and project.cluster_id:
            _, leaves = await intents.tree(user_id, conn, project.cluster_id)
            importance = {str(leaf.tab_ref): leaf.importance for leaf in leaves}
        live = (await _live(user_id, conn, [pid], now))[pid] if project else None
    snap = row["snapshot"]
    active, sessions, last, as_of = _totals(row, live)
    # Live importance first; a tab the current tree no longer has keeps its saved place (stable sort).
    tabs = sorted(snap.get("tabs", []), key=lambda t: -importance.get(t["tab_ref"], -1.0))
    common = ("tab_ref", "fallback_url", "domain", "title")
    return ResumeCard(
        id=ids.out(ids.CONTEXT, row["id"]), project_id=ids.out(ids.PROJECT, pid),
        project_name=project.name if project else snap.get("project_name"), kind=row["kind"], title=row["title"],
        saved_at=iso(row["saved_at"]), last_resumed_at=iso(row["last_resumed_at"]), last_active_at=last,
        active_ms=active, session_count=sessions, totals_as_of=as_of, card=snap.get("card"),
        important_tabs=[ResumeTab(**{k: t[k] for k in common}, importance=importance.get(t["tab_ref"]))
                        for t in tabs if t.get("important")],
        other_tabs=[ResumeOtherTab(**{k: t[k] for k in common}, importance=importance.get(t["tab_ref"]),
                                   excluded_reason=t.get("excluded_reason"))
                    for t in tabs if not t.get("important")],
        restore_options=RESTORE_OPTIONS)
