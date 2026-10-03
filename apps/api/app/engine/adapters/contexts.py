"""C13 adapter: saved contexts, read from P's saved_contexts (they trigger research memory, R-12).

The engine calls only get_contexts_source(); today it returns the fixture source, seeded
from P's contracts/saved-context.example.json list response.

TODO(R-15): add a source that reads P's `saved_contexts` table through db.get_pool(). If
the pool is None, the table or a column is missing, or a query fails, fall back to
FixtureContexts.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
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


class ContextsSource(Protocol):
    async def saved_contexts(self, user_id: UUID, since: datetime | None = None) -> list[SavedContext]: ...


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


def get_contexts_source() -> ContextsSource:
    return FixtureContexts()
