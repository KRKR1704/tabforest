"""POST /api/grove/grow and GET /api/grove response (contracts/grove.example.json and
grove.degraded.example.json share this model)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import Field

from .common import Claim, Confidence, Strict

SourceType = Literal["docs", "qa", "code", "discussion", "video", "search", "work_tool", "article", "other"]


class Leaf(Strict):
    tab_ref: str
    title: str
    domain: str
    source_type: SourceType
    dwell_min: float
    is_open: bool
    importance: float
    fallen: bool


class Branch(Strict):
    label: str
    status: Literal["active", "explored"]
    leaves: list[Leaf]


class Stone(Claim):
    kind: Literal["carved", "mossy"]
    user_note_id: str | None
    quote: str | None


class Mushroom(Claim):
    kind: Literal["repeated_search", "unresolved_comparison", "dormant_mid_comparison"]
    status: Literal["open", "resolved"]
    answer: str | None
    resolved_at: datetime | None
    recurrence: int = Field(ge=1)


class NextAction(Claim):
    unblocks: str | None
    reason: str


class Vine(Strict):
    tab_refs: list[str]
    kind: Literal["exact", "semantic"]
    keep_ref: str
    reason: str


class QueryFamily(Strict):
    id: str
    queries: list[str]
    tab_refs: list[str]
    open_loop: bool


class Tree(Strict):
    project_id: str
    name: str
    is_existing_project_id: str | None
    goal: Claim
    attention_min: int
    days_since_active: int
    canopy: Literal["green", "amber"]
    fogged: bool
    branches: list[Branch]
    direction: Claim | None
    stones: list[Stone]
    mushrooms: list[Mushroom]
    next_actions: list[NextAction]
    vines: list[Vine]
    hypotheses: list[Claim]
    query_families: list[QueryFamily]
    important_tab_refs: list[str]
    shared_tab_refs: list[str]


class Sprout(Strict):
    label: str
    tab_refs: list[str]


class FogItem(Strict):
    tab_ref: str
    reason: str


class Firefly(Strict):
    id: str
    project_id: str
    past_project_id: str
    past_project_name: str
    past_date: date
    similarity: Confidence
    saved_context_id: str | None
    display_text: str


class GroveResponse(Strict):
    run_id: str
    generated_at: datetime
    hollow_count: int = Field(ge=0)
    degraded: bool
    banner_text: str | None
    trees: list[Tree]
    sprouts: list[Sprout]
    meadow: list[str]
    fog: list[FogItem]
    fireflies: list[Firefly]
