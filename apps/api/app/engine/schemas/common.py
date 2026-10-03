"""Building blocks shared by the engine's API models."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

TabRef = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")]
Provenance = Literal["stated", "sourced", "inferred", "hypothesis"]
Confidence = Annotated[float, Field(ge=0.0, le=1.0)]


class Strict(BaseModel):
    """Every engine model rejects unknown fields, so a payload that drifts from the
    contracts/ examples fails loudly instead of being silently trimmed."""

    model_config = ConfigDict(extra="forbid")


class Evidence(Strict):
    ref_kind: Literal["tab", "query", "note", "doc"]
    ref: str
    why: str


class Claim(Strict):
    """Every claim the UI renders: provenance pill, confidence, wording set by provenance, roots."""

    id: str
    text: str
    provenance: Provenance
    confidence: Confidence
    display_text: str
    evidence: list[Evidence]
    user_note_id: str | None = None


class ValidationIssue(Strict):
    loc: list[str | int]
    msg: str
    type: str


class ProblemDetail(Strict):
    """RFC 7807 problem JSON."""

    type: str
    title: str
    status: int
    detail: str
    instance: str
    errors: list[ValidationIssue] | None = None
