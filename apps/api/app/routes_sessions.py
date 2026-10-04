"""P-7: GET /api/sessions and GET /api/sessions/{session_id} (contracts/sessions.example.json).

Attention and switch counts come from the session's stored events; projects and intent switches
come from R's current clusters at query time (C12), so a user's leaf reassignment shows up on the
next read. Tabs with no cluster are counted as unassigned, never guessed.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, Query, Request

from app import ids
from app.adapters import intents
from app.auth import current_user
from app.clock import now as clock_now
from app.db import repository as repo
from app.errors import not_found
from app.routes import db_pool
from app.schemas import SessionDetail, SessionList, SessionOut, SessionProject, SessionTab, iso
from app.sessions import GAP
from app.switches import INTENT, UNASSIGNED, session_kind

router = APIRouter(prefix="/api", tags=["sessions"])

RANGES = {"24h": timedelta(hours=24), "7d": timedelta(days=7)}


def summarize(session: asyncpg.Record, tabs: Iterable[asyncpg.Record], switches: Iterable[asyncpg.Record],
              member: intents.Membership, now: datetime) -> SessionOut:
    """One session row: BLUR time split by project (a tab in two projects counts for both), and
    tab switches split into intent and unassigned ones."""
    active = unassigned = 0
    per_project: dict[UUID, int] = defaultdict(int)
    for t in tabs:
        active += t["active_ms"]
        owners = member.projects_of.get(t["tab_ref"], ())
        for p in owners:
            per_project[p] += t["active_ms"]
        if not owners:
            unassigned += t["active_ms"]
    counts = {"tab": 0, INTENT: 0, UNASSIGNED: 0}
    for s in switches:
        counts["tab"] += s["n"]
        kind = session_kind(s["previous_tab_ref"], s["tab_ref"], member.clusters_of)
        if kind in counts:
            counts[kind] += s["n"]
    projects = sorted(per_project.items(), key=lambda kv: (-kv[1], member.names[kv[0]]))
    is_open = session["ended_at"] > now - GAP
    return SessionOut(
        id=ids.out(ids.SESSION, session["id"]), started_at=iso(session["started_at"]),
        ended_at=None if is_open else iso(session["ended_at"]), event_count=session["event_count"],
        active_ms=active, tab_switches=counts["tab"], intent_switches=counts[INTENT],
        unassigned_switches=counts[UNASSIGNED],
        projects=[SessionProject(project_id=ids.out(ids.PROJECT, p), name=member.names[p], active_ms=ms)
                  for p, ms in projects],
        unassigned_ms=unassigned)


def _by_session(rows: Iterable[asyncpg.Record]) -> dict[UUID, list[asyncpg.Record]]:
    out: dict[UUID, list[asyncpg.Record]] = defaultdict(list)
    for r in rows:
        out[r["session_id"]].append(r)
    return out


@router.get("/sessions", response_model=SessionList)
async def list_sessions(request: Request, range_: Literal["24h", "7d"] = Query("24h", alias="range"),
                        user_id: UUID = Depends(current_user), now: datetime = Depends(clock_now)) -> SessionList:
    """Sessions that started in the range, newest first."""
    pool = await db_pool(request)   # after validation, so a bad range is 422 even with storage down
    async with pool.acquire() as conn:
        sessions = await repo.list_sessions(user_id, conn, now - RANGES[range_], now)
        tabs, switches = await repo.session_activity(user_id, conn, sessions)
        member = await intents.membership(user_id, conn)
    tabs_of, switches_of = _by_session(tabs), _by_session(switches)
    return SessionList(range=range_, sessions=[
        summarize(s, tabs_of[s["id"]], switches_of[s["id"]], member, now) for s in sessions])


@router.get("/sessions/{session_id}", response_model=SessionDetail)
async def get_session(request: Request, session_id: str, user_id: UUID = Depends(current_user),
                      now: datetime = Depends(clock_now)) -> SessionDetail:
    """One session plus every tab focused in it; another user's session is 404."""
    sid = ids.parse(ids.SESSION, session_id)
    pool = await db_pool(request)
    async with pool.acquire() as conn:
        session = await repo.get_session(user_id, conn, sid) if sid else None
        if session is None:
            raise not_found("Session not found")
        tabs, switches = await repo.session_activity(user_id, conn, [session])
        member = await intents.membership(user_id, conn)
        info = await repo.tab_info(user_id, conn, [t["tab_ref"] for t in tabs])
    row = summarize(session, tabs, switches, member, now)
    ordered = sorted(tabs, key=lambda t: (-t["active_ms"], str(t["tab_ref"])))
    return SessionDetail(**row.model_dump(), tabs=[
        SessionTab(tab_ref=t["tab_ref"], domain=info[t["tab_ref"]]["domain"] if t["tab_ref"] in info else None,
                   title=info[t["tab_ref"]]["title"] if t["tab_ref"] in info else None,
                   active_ms=t["active_ms"],
                   project_ids=[ids.out(ids.PROJECT, p) for p in member.projects_of.get(t["tab_ref"], ())])
        for t in ordered])
