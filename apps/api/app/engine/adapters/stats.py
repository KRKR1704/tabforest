"""C11 adapter: raw events and attention for tab_refs, read from P's browser_events.

The engine calls only get_stats_source(); today it returns the fixture source.

TODO(R-15): add a source that reads P's `browser_events` (incl. session_id and
previous_tab_ref) and the `tab_attention_15m` aggregate through db.get_pool(). If the pool
is None, a table or column is missing, or a query fails, fall back to FixtureStats.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from ..fixtures import load_events


def _ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@dataclass(frozen=True)
class TabEvent:
    event_id: str
    ts: datetime
    type: str
    tab_ref: str
    session_id: str
    previous_tab_ref: str | None = None
    active_ms: int | None = None
    opener_tab_ref: str | None = None
    domain: str | None = None
    title: str | None = None
    dup_key: str | None = None
    search_query: str | None = None


@dataclass(frozen=True)
class TabAttention:
    tab_ref: str
    active_ms: int
    focus_count: int
    last_focus: datetime | None


class StatsSource(Protocol):
    async def events(self, user_id: UUID, tab_refs: set[str], since: datetime | None = None) -> list[TabEvent]: ...

    async def events_since(self, user_id: UUID, since: datetime) -> list[TabEvent]:
        """Every event of the user from `since` on, incl. tabs that are closed now (query families)."""
        ...

    async def attention(self, user_id: UUID, tab_refs: set[str],
                        since: datetime | None = None) -> dict[str, TabAttention]: ...


class FixtureStats:
    """Single-user fixture: every event belongs to the demo user, so user_id is not filtered."""

    def __init__(self) -> None:
        self._events = [
            TabEvent(**{k: v for k, v in e.items() if k in TabEvent.__dataclass_fields__ and k != "ts"},
                     ts=_ts(e["ts"]))
            for e in load_events()["events"]
        ]

    async def events(self, user_id: UUID, tab_refs: set[str], since: datetime | None = None) -> list[TabEvent]:
        return [e for e in self._events if e.tab_ref in tab_refs and (since is None or e.ts >= since)]

    async def events_since(self, user_id: UUID, since: datetime) -> list[TabEvent]:
        return [e for e in self._events if e.ts >= since]

    async def attention(self, user_id: UUID, tab_refs: set[str],
                        since: datetime | None = None) -> dict[str, TabAttention]:
        totals: dict[str, list] = {ref: [0, 0, None] for ref in tab_refs}
        for e in await self.events(user_id, tab_refs, since):
            row = totals[e.tab_ref]
            if e.type == "BLUR" and e.active_ms:
                row[0] += e.active_ms
            elif e.type == "FOCUS":
                row[1] += 1
                row[2] = e.ts
        return {ref: TabAttention(ref, ms, focuses, last) for ref, (ms, focuses, last) in totals.items()}


def get_stats_source() -> StatsSource:
    return FixtureStats()
