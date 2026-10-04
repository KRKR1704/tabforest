"""C11 adapter: raw events and attention for tab_refs, read from P's browser_events.

The engine calls only get_stats_source(pool). With a database it returns DbStats, which reads P's `browser_events`
(session_id, previous_tab_ref, active_ms) for the signed-in user. Without one, or when the table or a query is
unavailable, it answers from the fixture events (the 28-tab demo), so the engine still runs standalone (R-15).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol
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

    async def attention_ms(self, user_id: UUID, tab_refs: set[str]) -> int:
        """Total focus time of these tabs, ever: from P's tab_attention_15m aggregate, which outlives the raw rows
        (R-12 reads the minutes of research from months ago)."""
        ...


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

    async def attention_ms(self, user_id: UUID, tab_refs: set[str]) -> int:
        return sum(a.active_ms for a in (await self.attention(user_id, tab_refs)).values())


log = logging.getLogger("tabforest.engine.stats")
EVENTS_SINCE_LIMIT = 20_000

_EVENT_COLUMNS = ("event_id, ts, event_type, tab_ref, session_id, previous_tab_ref, active_ms, opener_tab_ref, "
                  "domain, title, dup_key, search_query")


def _event(row: Any) -> TabEvent:
    def text(value: Any) -> str | None:
        return None if value is None else str(value)

    blur = row["event_type"] == "BLUR"
    return TabEvent(event_id=str(row["event_id"]), ts=row["ts"], type=row["event_type"], tab_ref=str(row["tab_ref"]),
                    session_id=str(row["session_id"]), previous_tab_ref=text(row["previous_tab_ref"]),
                    active_ms=int(row["active_ms"]) if blur else None, opener_tab_ref=text(row["opener_tab_ref"]),
                    domain=row["domain"], title=row["title"], dup_key=row["dup_key"],
                    search_query=row["search_query"])


class DbStats:
    """P's browser_events for one user. Every query filters on user_id; refs that are not UUIDs match nothing.

    If the database is missing the table or a query fails, the fixture answers instead (logged once). If nothing is
    stored for the asked tabs and they are all demo tabs, the fixture answers too, so replaying the demo snapshot
    against a database without the demo user's events still shows the demo.
    """

    def __init__(self, pool: Any, fallback: StatsSource | None = None) -> None:
        self.pool = pool
        self.fallback = fallback or FixtureStats()
        self._demo_refs = {e.tab_ref for e in getattr(self.fallback, "_events", [])}
        self._replaying_demo = False  # set when the demo tabs were answered from fixtures; events_since follows suit

    def _is_demo(self, tab_refs: set[str]) -> bool:
        return bool(tab_refs) and tab_refs <= self._demo_refs

    @staticmethod
    def _uuids(tab_refs: set[str]) -> list[UUID]:
        out = []
        for ref in tab_refs:
            try:
                out.append(UUID(ref))
            except ValueError:
                continue
        return out

    async def events(self, user_id: UUID, tab_refs: set[str], since: datetime | None = None) -> list[TabEvent]:
        try:
            rows = await self.pool.fetch(
                f"SELECT {_EVENT_COLUMNS} FROM browser_events WHERE user_id = $1 AND tab_ref = ANY($2::uuid[]) "  # noqa: S608
                "AND ($3::timestamptz IS NULL OR ts >= $3) ORDER BY ts, event_id", user_id, self._uuids(tab_refs), since)
        except Exception as exc:  # noqa: BLE001 - the engine must run without P's table
            log.warning("stats: browser_events unavailable (%s); using the fixture events", type(exc).__name__)
            return await self.fallback.events(user_id, tab_refs, since)
        if not rows and self._is_demo(tab_refs):
            self._replaying_demo = True
            return await self.fallback.events(user_id, tab_refs, since)
        return [_event(r) for r in rows]

    async def events_since(self, user_id: UUID, since: datetime) -> list[TabEvent]:
        try:
            rows = await self.pool.fetch(
                f"SELECT {_EVENT_COLUMNS} FROM browser_events WHERE user_id = $1 AND ts >= $2 "  # noqa: S608
                "ORDER BY ts, event_id LIMIT $3", user_id, since, EVENTS_SINCE_LIMIT)
        except Exception as exc:  # noqa: BLE001
            log.warning("stats: browser_events unavailable (%s); using the fixture events", type(exc).__name__)
            return await self.fallback.events_since(user_id, since)
        if not rows and self._replaying_demo:
            return await self.fallback.events_since(user_id, since)
        return [_event(r) for r in rows]

    async def attention(self, user_id: UUID, tab_refs: set[str], since: datetime | None = None) -> dict[str, TabAttention]:
        try:
            rows = await self.pool.fetch(
                "SELECT tab_ref, coalesce(sum(active_ms) FILTER (WHERE event_type = 'BLUR'), 0) AS ms, "
                "count(*) FILTER (WHERE event_type = 'FOCUS') AS focuses, "
                "max(ts) FILTER (WHERE event_type = 'FOCUS') AS last_focus FROM browser_events "
                "WHERE user_id = $1 AND tab_ref = ANY($2::uuid[]) AND ($3::timestamptz IS NULL OR ts >= $3) "
                "GROUP BY tab_ref", user_id, self._uuids(tab_refs), since)
        except Exception as exc:  # noqa: BLE001
            log.warning("stats: browser_events unavailable (%s); using the fixture events", type(exc).__name__)
            return await self.fallback.attention(user_id, tab_refs, since)
        if not rows and self._is_demo(tab_refs):
            self._replaying_demo = True
            return await self.fallback.attention(user_id, tab_refs, since)
        found = {str(r["tab_ref"]): TabAttention(str(r["tab_ref"]), int(r["ms"]), int(r["focuses"]), r["last_focus"])
                 for r in rows}
        return {ref: found.get(ref, TabAttention(ref, 0, 0, None)) for ref in tab_refs}


    async def attention_ms(self, user_id: UUID, tab_refs: set[str]) -> int:
        try:
            total = await self.pool.fetchval(
                "SELECT coalesce(sum(active_ms), 0) FROM tab_attention_15m WHERE user_id = $1 AND tab_ref = ANY($2::uuid[])",
                user_id, self._uuids(tab_refs))
        except Exception as exc:  # noqa: BLE001 - no aggregate: count the raw events instead
            log.warning("stats: tab_attention_15m unavailable (%s); summing the raw events", type(exc).__name__)
            return sum(a.active_ms for a in (await self.attention(user_id, tab_refs)).values())
        if not total:  # rows inserted behind the aggregate's refresh watermark are only in the raw events
            raw = sum(a.active_ms for a in (await self.attention(user_id, tab_refs)).values())
            if not raw and self._is_demo(tab_refs):
                return await self.fallback.attention_ms(user_id, tab_refs)
            return raw
        return int(total)


def get_stats_source(pool: Any = None) -> StatsSource:
    """DbStats when there is a database pool, else the fixture events."""
    return DbStats(pool) if pool is not None else FixtureStats()
