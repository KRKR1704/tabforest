"""P's request and response models (P-5). Every request model uses extra="forbid", so a body
with user_id (or any unknown field) returns 422 (SPEC §10, §11.2).

Shapes follow contracts/events.example.json and me.example.json.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

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


def iso(value: datetime | None) -> str | None:
    """UTC, second precision, Z suffix, as in the contracts. asyncpg returns timestamptz as aware datetimes."""
    return None if value is None else value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
