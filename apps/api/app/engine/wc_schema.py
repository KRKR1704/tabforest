"""The model's output for Work Context (R-11), sent as a strict Structured Outputs schema.

Same strict-mode rules as model_schema.py: every field required, optional values are `X | None`, no range
constraints (validate.py and work_context.py enforce them). The model never writes a timestamp or the final
wording: the server finds the cue time of a verified quote and sets display text from the provenance.
Refs are document refs only: d1..dN.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from .model_schema import EvidenceRef

# No "stated": that level is the user's own note, and Work Context has no user notes.
WcProvenance = Literal["sourced", "inferred", "hypothesis"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WcClaimOut(_Strict):
    text: str
    provenance: WcProvenance
    confidence: float
    quote: str | None
    evidence: list[EvidenceRef]


class WcDecisionOut(WcClaimOut):
    speaker: str | None


class WcOwnerOut(WcClaimOut):
    person: str
    task: str


class WcQuestionOut(WcClaimOut):
    answered: bool
    answer: str | None
    recurrence: int


class WcActionOut(WcClaimOut):
    unblocks_blocker: int | None  # 0-based index into blockers


class WorkContextInference(_Strict):
    project_name: str
    goal: WcClaimOut
    decisions: list[WcDecisionOut]
    blockers: list[WcClaimOut]
    owners: list[WcOwnerOut]
    open_questions: list[WcQuestionOut]
    next_actions: list[WcActionOut]
