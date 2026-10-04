"""C1 adapter (D → P): turns POST /api/events items into browser_events rows and tab updates.

Fields kept per type follow contracts/events.example.json: OPEN keeps domain, title,
opener_tab_ref, dup_key, search_query; UPDATE the same without opener_tab_ref; FOCUS keeps
previous_tab_ref; BLUR keeps active_ms. A field sent on a type that doesn't use it is dropped
rather than rejected, so one odd event can't jam the extension's queue (it retries a batch
until it gets a 202).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from app.schemas import EventIn, EventType

KEPT: dict[EventType, frozenset[str]] = {
    EventType.OPEN: frozenset({"domain", "title", "opener_tab_ref", "dup_key", "search_query"}),
    EventType.UPDATE: frozenset({"domain", "title", "dup_key", "search_query"}),
    EventType.FOCUS: frozenset({"previous_tab_ref"}),
    EventType.BLUR: frozenset({"active_ms"}),
    EventType.CLOSE: frozenset(),
    EventType.IDLE: frozenset(),
    EventType.ACTIVE: frozenset(),
}


@dataclass(frozen=True)
class EventRow:
    ts: datetime
    event_id: UUID
    tab_ref: UUID
    event_type: str
    domain: str | None
    title: str | None
    search_query: str | None
    opener_tab_ref: UUID | None
    previous_tab_ref: UUID | None
    dup_key: str | None
    active_ms: int
    is_tab_switch: bool


@dataclass(frozen=True)
class TabUpdate:
    """P's columns of tabs (§4.5) from one batch."""

    tab_ref: UUID
    first_seen: datetime
    last_focus: datetime | None
    domain: str | None
    domain_seen_at: datetime | None


def to_row(event: EventIn) -> EventRow:
    kept = KEPT[event.type]

    def keep(name: str):
        return getattr(event, name) if name in kept else None

    previous = keep("previous_tab_ref")
    return EventRow(
        ts=event.ts, event_id=event.event_id, tab_ref=event.tab_ref, event_type=event.type.value,
        domain=keep("domain"), title=keep("title"), search_query=keep("search_query"),
        opener_tab_ref=keep("opener_tab_ref"), previous_tab_ref=previous, dup_key=keep("dup_key"),
        active_ms=keep("active_ms") or 0,
        # §4.6: a fact recorded at ingest. Intent switches are derived later from R's clusters.
        is_tab_switch=event.type is EventType.FOCUS and previous is not None and previous != event.tab_ref,
    )


def tab_updates(rows: list[EventRow]) -> list[TabUpdate]:
    """first_seen = earliest event; last_focus = latest FOCUS or BLUR; domain = from the latest OPEN/UPDATE."""
    by_tab: dict[UUID, dict] = {}
    for row in rows:
        t = by_tab.setdefault(row.tab_ref, {"first_seen": row.ts, "last_focus": None,
                                            "domain": None, "domain_seen_at": None})
        t["first_seen"] = min(t["first_seen"], row.ts)
        if row.event_type in ("FOCUS", "BLUR"):
            t["last_focus"] = row.ts if t["last_focus"] is None else max(t["last_focus"], row.ts)
        if row.domain and (t["domain_seen_at"] is None or row.ts >= t["domain_seen_at"]):
            t["domain"], t["domain_seen_at"] = row.domain, row.ts
    return [TabUpdate(tab_ref=ref, **t) for ref, t in by_tab.items()]
