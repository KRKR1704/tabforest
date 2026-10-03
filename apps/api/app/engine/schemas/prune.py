"""POST /api/tabs/prune-suggestions (contracts/prune.example.json)."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from .common import Strict, TabRef

MAX_TABS = 60


class PruneRequest(Strict):
    tab_refs: list[TabRef] = Field(min_length=1, max_length=MAX_TABS)


class PruneSuggestion(Strict):
    id: str
    kind: Literal["exact_duplicate", "semantic_redundant", "stale", "distraction"]
    tab_refs: list[str]
    keep_ref: str | None
    reason: str
    default_selected: bool


class PruneAction(Strict):
    id: Literal["keep_all", "close_selected", "save_as_references", "prune_branch"]
    label: str


class PruneResponse(Strict):
    suggestions: list[PruneSuggestion]
    actions: list[PruneAction]
    note: str
