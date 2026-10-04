"""C13 adapter: saved contexts, read from P's saved_contexts (they trigger research memory, R-12).

The engine calls only get_contexts_source(); today it returns the fixture source, seeded
from P's contracts/saved-context.example.json list response.

TODO(R-15): add a source that reads P's `saved_contexts` table through db.get_pool(). If
the pool is None, the table or a column is missing, or a query fails, fall back to
FixtureContexts.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol
from uuid import UUID

from ..fixtures import load_contract


def _ts(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


@dataclass(frozen=True)
class SavedContext:
    id: str
    project_id: str
    project_name: str
    kind: str  # resume | references
    title: str
    saved_at: datetime
    last_active_at: datetime | None
    user_id: UUID | None = None  # set by the database source; the fixture is single-user


class ContextsSource(Protocol):
    async def saved_contexts(self, user_id: UUID, since: datetime | None = None) -> list[SavedContext]: ...

    async def recent(self, since: datetime) -> list[SavedContext]:
        """Saved contexts of every user saved since `since` (the research-memory trigger, R-12)."""
        ...


class FixtureContexts:
    """Single-user fixture: every context belongs to the demo user, so user_id is not filtered."""

    def __init__(self) -> None:
        example = next(e for e in load_contract("saved-context.example.json")["examples"]
                       if e["request"]["method"] == "GET")
        self._contexts = [
            SavedContext(id=c["id"], project_id=c["project_id"], project_name=c["project_name"], kind=c["kind"],
                         title=c["title"], saved_at=_ts(c["saved_at"]), last_active_at=_ts(c["last_active_at"]))
            for c in example["response"]["body"]["contexts"]
        ]

    async def saved_contexts(self, user_id: UUID, since: datetime | None = None) -> list[SavedContext]:
        return [c for c in self._contexts if since is None or c.saved_at >= since]


    async def recent(self, since: datetime) -> list[SavedContext]:
        return []  # the fixture has no user: nothing for the memory pass to attribute an insight to


log = logging.getLogger("tabforest.engine.contexts")


class DbContexts:
    """P's saved_contexts (C13). Every per-user query filters on user_id; on any failure the fixture answers."""

    def __init__(self, pool: Any, fallback: ContextsSource | None = None) -> None:
        self.pool = pool
        self.fallback = fallback or FixtureContexts()

    @staticmethod
    def _row(r: Any) -> SavedContext:
        # project_id is R's projects.id (no foreign key); a context saved before its project exists has none
        return SavedContext(id=f"s_{r['id']}", project_id=f"p_{r['project_id']}" if r["project_id"] else "",
                            project_name=r["project_name"] or "", kind=r["kind"], title=r["title"], saved_at=r["saved_at"],
                            last_active_at=r["last_active_at"], user_id=r["user_id"])

    _SELECT = ("SELECT sc.id, sc.user_id, sc.project_id, p.name AS project_name, sc.kind, sc.title, sc.saved_at, "
               "p.last_active_at FROM saved_contexts sc LEFT JOIN projects p ON p.id = sc.project_id AND p.user_id = sc.user_id ")

    async def saved_contexts(self, user_id: UUID, since: datetime | None = None) -> list[SavedContext]:
        try:
            rows = await self.pool.fetch(self._SELECT + "WHERE sc.user_id = $1 AND ($2::timestamptz IS NULL OR sc.saved_at >= $2) "
                                         "ORDER BY sc.saved_at DESC", user_id, since)
        except Exception as exc:  # noqa: BLE001
            log.warning("contexts: saved_contexts unavailable (%s); using the fixture", type(exc).__name__)
            return await self.fallback.saved_contexts(user_id, since)
        return [self._row(r) for r in rows]

    async def recent(self, since: datetime) -> list[SavedContext]:
        try:
            rows = await self.pool.fetch(self._SELECT + "WHERE sc.saved_at >= $1 ORDER BY sc.saved_at DESC LIMIT 500", since)
        except Exception as exc:  # noqa: BLE001
            log.warning("contexts: saved_contexts unavailable (%s)", type(exc).__name__)
            return []
        return [self._row(r) for r in rows]


def get_contexts_source(pool: Any = None) -> ContextsSource:
    """DbContexts with a database pool, else the fixture."""
    return DbContexts(pool) if pool is not None else FixtureContexts()
