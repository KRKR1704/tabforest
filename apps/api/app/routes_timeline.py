"""P-8: GET /api/projects/{project_id}/timeline?range=24h (contracts/timeline.example.json).

Lanes are the branches of the project's current tree (C12), filled from tab_attention_15m in
30-minute buckets: attention lands in the bucket of the BLUR event that carries it. Switches are
focus changes that enter or leave the project's tabs, classified from the project's side.
Markers are R's decisions and open questions, placed in time (adapters/intents.markers).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from app import ids
from app.adapters import intents
from app.auth import current_user
from app.clock import now as clock_now
from app.db import repository as repo
from app.errors import not_found
from app.routes import db_pool
from app.schemas import (
    DecisionMarker,
    QuestionMarker,
    SwitchBucket,
    Timeline,
    TimelineLane,
    TimelinePoint,
    TimelineTab,
    TimelineTotals,
    iso,
)
from app.switches import INTENT, UNASSIGNED, project_kind

router = APIRouter(prefix="/api", tags=["timeline"])

RANGE = timedelta(hours=24)


def bucket_30m(ts: datetime) -> datetime:
    return ts.replace(minute=ts.minute - ts.minute % 30, second=0, microsecond=0)


@router.get("/projects/{project_id}/timeline", response_model=Timeline)
async def get_timeline(request: Request, project_id: str,
                       range_: Literal["24h"] = Query("24h", alias="range"),
                       user_id: UUID = Depends(current_user), now: datetime = Depends(clock_now)) -> Timeline:
    """Attention lanes per branch for the last 24 hours; another user's project is 404."""
    pid = ids.parse(ids.PROJECT, project_id)
    since = now - RANGE
    pool = await db_pool(request)
    async with pool.acquire() as conn:
        project = await intents.project(user_id, conn, pid) if pid else None
        if project is None:
            raise not_found("Project not found")
        branches, leaves, markers = [], [], []
        if project.cluster_id:
            branches, leaves = await intents.tree(user_id, conn, project.cluster_id)
            markers = await intents.markers(user_id, conn, project.cluster_id)
        tab_refs = [leaf.tab_ref for leaf in leaves]
        attention = await repo.attention_30m(user_id, conn, tab_refs, since, now)
        switches = await repo.switches_touching(user_id, conn, tab_refs, since, now)
        member = await intents.membership(user_id, conn) if switches else intents.Membership()
        info = await repo.tab_info(user_id, conn, sorted({a["tab_ref"] for a in attention}, key=str))

    branch_of = {leaf.tab_ref: leaf.branch_id for leaf in leaves}
    by_branch: dict[UUID | None, dict[datetime, list]] = defaultdict(lambda: defaultdict(list))
    for a in attention:
        by_branch[branch_of[a["tab_ref"]]][a["t"]].append(a)

    def lane(branch: str | None, status: str | None, points: dict[datetime, list]) -> TimelineLane:
        out = []
        for t in sorted(points):
            rows = sorted(points[t], key=lambda a: (-a["active_ms"], str(a["tab_ref"])))
            out.append(TimelinePoint(t=iso(t), active_ms=sum(a["active_ms"] for a in rows), tabs=[
                TimelineTab(tab_ref=a["tab_ref"], domain=info[a["tab_ref"]]["domain"] if a["tab_ref"] in info else None,
                            title=info[a["tab_ref"]]["title"] if a["tab_ref"] in info else None,
                            active_ms=a["active_ms"]) for a in rows]))
        return TimelineLane(branch=branch, status=status, active_ms=sum(p.active_ms for p in out), points=out)

    lanes = [lane(b.label, b.status, by_branch.get(b.id, {})) for b in branches]
    if None in by_branch:
        lanes.append(lane(None, None, by_branch[None]))

    project_tabs = set(tab_refs)
    mine = frozenset({project.cluster_id}) if project.cluster_id else frozenset()
    counts: dict[datetime, dict[str, int]] = defaultdict(lambda: {"tab": 0, INTENT: 0, UNASSIGNED: 0})
    for s in switches:
        other = s["tab_ref"] if s["previous_tab_ref"] in project_tabs else s["previous_tab_ref"]
        kind = project_kind(other, mine, member.clusters_of)
        c = counts[bucket_30m(s["ts"])]
        c["tab"] += 1
        if kind in c:
            c[kind] += 1
    buckets = [SwitchBucket(t=iso(t), tab_switches=c["tab"], intent_switches=c[INTENT],
                            unassigned_switches=c[UNASSIGNED]) for t, c in sorted(counts.items())]

    placed = sorted((m for m in markers if m.t is not None and since <= m.t <= now), key=lambda m: (m.t, str(m.id)))
    marker_out = [DecisionMarker(t=iso(m.t), id=ids.out(ids.DECISION, m.id), text=m.text, provenance=m.provenance)
                  if m.kind == "decision" else
                  QuestionMarker(t=iso(m.t), id=ids.out(ids.QUESTION, m.id), text=m.text, status=m.status)
                  for m in placed]

    return Timeline(
        project_id=ids.out(ids.PROJECT, project.id), name=project.name, range=range_, bucket="30m",
        from_=iso(since), to=iso(now), lanes=lanes, switches=buckets, markers=marker_out,
        totals=TimelineTotals(active_ms=sum(ln.active_ms for ln in lanes),
                              tab_switches=sum(b.tab_switches for b in buckets),
                              intent_switches=sum(b.intent_switches for b in buckets),
                              unassigned_switches=sum(b.unassigned_switches for b in buckets)))
