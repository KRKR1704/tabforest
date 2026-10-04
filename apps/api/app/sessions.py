"""Sessionization (§4.11; P is the only owner): a session is a run of a user's events with no gap
longer than 30 minutes between consecutive events, by event ts.

Batches can arrive late or out of order (D-5 flushes after an offline period), so a batch is
placed against the sessions already stored around it: its events may join a session, extend one,
start a new one, or fill the gap between two sessions so they become one. plan_sessions() is the
pure part; the repository applies the plan in the ingest transaction.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from uuid import UUID, uuid4

GAP = timedelta(minutes=30)  # a gap of exactly 30:00 stays in the session; longer starts a new one


@dataclass(frozen=True)
class StoredSession:
    id: UUID
    started_at: datetime
    ended_at: datetime  # ts of the session's last event so far


@dataclass
class SessionGroup:
    session_id: UUID
    is_new: bool
    merged_ids: list[UUID] = field(default_factory=list)  # stored sessions folded into session_id
    event_indexes: list[int] = field(default_factory=list)
    start: datetime | None = None
    end: datetime | None = None


def plan_sessions(stored: list[StoredSession], event_ts: list[datetime]) -> list[SessionGroup]:
    """Assign every new event to a session. Only groups that receive events are returned.

    `stored` must hold every stored session within GAP of some new event; sessions further away
    can't be affected because stored sessions are already more than GAP apart from each other.
    """
    items: list[tuple[datetime, datetime, str, object]] = (
        [(s.started_at, s.ended_at, "session", s) for s in stored]
        + [(ts, ts, "event", i) for i, ts in enumerate(event_ts)]
    )
    items.sort(key=lambda item: (item[0], item[2] == "event"))

    raw_groups: list[list[tuple[datetime, datetime, str, object]]] = []
    group_end: datetime | None = None
    for item in items:
        start, end = item[0], item[1]
        if group_end is None or start - group_end > GAP:
            raw_groups.append([])
            group_end = end
        raw_groups[-1].append(item)
        group_end = max(group_end, end)

    plan: list[SessionGroup] = []
    for members in raw_groups:
        sessions = sorted((m[3] for m in members if m[2] == "session"), key=lambda s: s.started_at)
        indexes = [m[3] for m in members if m[2] == "event"]
        if not indexes:
            continue
        if sessions:
            survivor = sessions[0]
            group = SessionGroup(survivor.id, False, [s.id for s in sessions[1:]])
        else:
            group = SessionGroup(uuid4(), True)
        group.event_indexes = sorted(indexes)
        group.start = min(m[0] for m in members)
        group.end = max(m[1] for m in members)
        plan.append(group)
    return plan
