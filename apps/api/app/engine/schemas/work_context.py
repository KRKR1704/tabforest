"""Work Context (contracts/work-context.example.json): POST /api/work-context/analyze takes
JSON items; POST /api/work-context/upload takes multipart files[] plus an optional
items_json string holding the same items. Both return WorkContextResponse."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from .common import Claim, Strict

MAX_ITEM_CHARS = 12_000


class WorkItem(Strict):
    kind: Literal["page", "paste"]
    title: str = Field(min_length=1, max_length=300)
    domain: str | None = None
    text: str = Field(min_length=1, max_length=MAX_ITEM_CHARS)

    @model_validator(mode="after")
    def _domain_only_on_pages(self) -> WorkItem:
        if (self.kind == "page") != (self.domain is not None):
            raise ValueError("domain is required for pages and not allowed for pastes")
        return self


class AnalyzeRequest(Strict):
    items: list[WorkItem] = Field(min_length=1)


class WorkContextDocument(Strict):
    id: str
    kind: Literal["page", "paste", "file"]
    title: str
    source_type: Literal["ticket", "pull_request", "account_note", "transcript", "document"]


class WcItem(Claim):
    """A Work Context claim. Sourced items carry a verbatim quote, the source title and,
    for transcripts, the cue timestamp; inferred items have all three null."""

    quote: str | None
    source: str | None
    timestamp: str | None = Field(pattern=r"^\d{2}:\d{2}:\d{2}$")


class WcDecision(WcItem):
    speaker: str


class WcOwner(WcItem):
    person: str
    task: str


class WcQuestion(WcItem):
    status: Literal["open", "resolved"]
    answer: str | None
    resolved_at: datetime | None
    recurrence: int = Field(ge=1)


class WcAction(WcItem):
    rank: int = Field(ge=1)
    unblocks: str | None


class WorkContextResponse(Strict):
    run_id: str
    project: str
    documents: list[WorkContextDocument]
    goal: WcItem
    decisions: list[WcDecision]
    blockers: list[WcItem]
    owners: list[WcOwner]
    open_questions: list[WcQuestion]
    next_actions: list[WcAction]
    handoff_brief: str
