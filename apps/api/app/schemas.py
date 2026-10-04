"""P's request and response models (P-5). Every request model uses extra="forbid", so a body
with user_id (or any unknown field) returns 422 (SPEC §10, §11.2).

Shapes follow contracts/events.example.json and me.example.json.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import AfterValidator, AwareDatetime, BaseModel, ConfigDict, Field, ValidationInfo, field_validator
from pydantic_core import PydanticCustomError

TITLE_MAX = 300
BATCH_MAX = 500


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EventType(StrEnum):
    OPEN = "OPEN"
    FOCUS = "FOCUS"
    BLUR = "BLUR"
    UPDATE = "UPDATE"
    CLOSE = "CLOSE"
    IDLE = "IDLE"
    ACTIVE = "ACTIVE"


class EventIn(Strict):
    """One captured event. Which optional fields are stored depends on the type (adapters/events_in.py)."""

    event_id: UUID
    ts: AwareDatetime
    type: EventType
    tab_ref: UUID
    domain: str | None = Field(default=None, max_length=255)
    title: str | None = Field(default=None, max_length=TITLE_MAX)
    search_query: str | None = Field(default=None, max_length=1000)
    opener_tab_ref: UUID | None = None
    previous_tab_ref: UUID | None = None
    dup_key: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    active_ms: int | None = Field(default=None, ge=0, le=86_400_000)


class EventBatch(Strict):
    events: list[EventIn] = Field(min_length=1, max_length=BATCH_MAX)
    session_hint: str | None = Field(default=None, max_length=200)  # SPEC §10.1; ignored, the server owns sessions


class IngestResult(BaseModel):
    accepted: int
    duplicates: int


class LoginRequest(Strict):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=1024)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "Bearer"
    expires_in: int


class MeUser(BaseModel):
    id: UUID
    display_name: str | None
    email: str | None
    created_at: str


class MeStats(BaseModel):
    total_forests: int
    active_goals: int
    total_attention_ms: int
    total_resolved_questions: int


class PrivacyOut(BaseModel):
    excluded_domains: list[str]
    paused_until: str | None
    retention_days: int
    cloud_ai_enabled: bool
    updated_at: str


class MeResponse(BaseModel):
    user: MeUser
    first_sign_in: bool
    stats: MeStats
    privacy: PrivacyOut


class SessionProject(BaseModel):
    project_id: str
    name: str
    active_ms: int


class SessionOut(BaseModel):
    """contracts/sessions.example.json list row."""

    id: str
    started_at: str
    ended_at: str | None
    event_count: int
    active_ms: int
    tab_switches: int
    intent_switches: int
    unassigned_switches: int
    projects: list[SessionProject]
    unassigned_ms: int


class SessionTab(BaseModel):
    tab_ref: UUID
    domain: str | None
    title: str | None
    active_ms: int
    project_ids: list[str]


class SessionDetail(SessionOut):
    tabs: list[SessionTab]


class SessionList(BaseModel):
    range: str
    sessions: list[SessionOut]


class TimelineTab(BaseModel):
    tab_ref: UUID
    domain: str | None
    title: str | None
    active_ms: int


class TimelinePoint(BaseModel):
    t: str
    active_ms: int
    tabs: list[TimelineTab]


class TimelineLane(BaseModel):
    branch: str | None     # None: project tabs with no branch, so no attention is dropped
    status: str | None
    active_ms: int
    points: list[TimelinePoint]


class SwitchBucket(BaseModel):
    t: str
    tab_switches: int
    intent_switches: int
    unassigned_switches: int


class DecisionMarker(BaseModel):
    kind: Literal["decision"] = "decision"
    t: str
    id: str
    text: str
    provenance: str


class QuestionMarker(BaseModel):
    kind: Literal["question"] = "question"
    t: str
    id: str
    text: str
    status: str


class TimelineTotals(BaseModel):
    active_ms: int
    tab_switches: int
    intent_switches: int
    unassigned_switches: int


class Timeline(BaseModel):
    """contracts/timeline.example.json."""

    project_id: str
    name: str
    range: str
    bucket: str
    from_: str = Field(serialization_alias="from")
    to: str
    lanes: list[TimelineLane]
    switches: list[SwitchBucket]
    markers: list[DecisionMarker | QuestionMarker]
    totals: TimelineTotals


CARD_MAX_BYTES = 64_000


def _query_free(url: str) -> str:
    """Stripped URLs only (SPEC §6.1): the bridge's GET_URLS drops the query string and fragment."""
    if not url.startswith(("https://", "http://")):
        raise PydanticCustomError("value_error", "URL must start with http:// or https://",
                                  {"detail": "must start with http:// or https://"})
    if "?" in url or "#" in url:
        raise PydanticCustomError("value_error", "URL must not contain a query string or fragment",
                                  {"detail": "must not contain a query string or fragment"})
    return url


class SavedTabIn(Strict):
    tab_ref: UUID
    fallback_url: Annotated[str, Field(max_length=2048), AfterValidator(_query_free)]
    domain: str | None = Field(default=None, max_length=255)
    title: str | None = Field(default=None, max_length=TITLE_MAX)
    important: bool
    excluded_reason: Literal["exact_duplicate", "semantic_redundant", "stale"] | None = None


class SaveContextIn(Strict):
    """POST /api/projects/{id}/save-context. card holds R's claims as the grove page shows them; the
    server stores it unchanged and never re-derives a claim."""

    kind: Literal["resume", "references"]
    title: str = Field(min_length=1, max_length=TITLE_MAX)
    card: dict[str, Any] | None
    tabs: list[SavedTabIn] = Field(min_length=1, max_length=BATCH_MAX)

    @field_validator("card")
    @classmethod
    def _card_matches_kind(cls, card: dict[str, Any] | None, info: ValidationInfo) -> dict[str, Any] | None:
        kind = info.data.get("kind")
        if kind == "resume" and card is None:
            raise PydanticCustomError("value_error", "A resume context needs a card",
                                      {"detail": "is required when kind is resume"})
        if kind == "references" and card is not None:
            raise PydanticCustomError("value_error", "A references context has no card",
                                      {"detail": "must be null when kind is references"})
        if card is not None and len(json.dumps(card)) > CARD_MAX_BYTES:
            raise PydanticCustomError("value_error", "Card is too large", {"detail": "is too large"})
        return card


class ContextCreated(BaseModel):
    id: str
    project_id: str
    kind: str
    title: str
    saved_at: str
    important_tab_count: int
    total_tab_count: int


class ContextRow(BaseModel):
    """contracts/saved-context.example.json list row."""

    id: str
    project_id: str | None
    project_name: str | None
    kind: str
    title: str
    saved_at: str
    last_resumed_at: str | None
    last_active_at: str | None
    active_ms: int
    session_count: int
    totals_as_of: str | None   # null: live totals; else the save time whose recorded totals these are
    open_question_count: int
    important_tab_count: int
    total_tab_count: int
    goal_summary: str | None
    next_action: str | None


class ContextList(BaseModel):
    contexts: list[ContextRow]


class ResumeTab(BaseModel):
    tab_ref: UUID
    fallback_url: str
    domain: str | None
    title: str | None
    importance: float | None


class ResumeOtherTab(ResumeTab):
    excluded_reason: str | None


class ResumeCard(BaseModel):
    id: str
    project_id: str | None
    project_name: str | None
    kind: str
    title: str
    saved_at: str
    last_resumed_at: str | None
    last_active_at: str | None
    active_ms: int
    session_count: int
    totals_as_of: str | None
    card: dict[str, Any] | None
    important_tabs: list[ResumeTab]
    other_tabs: list[ResumeOtherTab]
    restore_options: list[str]


def iso(value: datetime | None) -> str | None:
    """UTC, second precision, Z suffix, as in the contracts. asyncpg returns timestamptz as aware datetimes."""
    return None if value is None else value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
