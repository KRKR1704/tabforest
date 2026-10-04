"""The model's output for one cluster (R-7, proposal §15), sent as a strict Structured Outputs schema.

Strict-mode rules (Azure OpenAI structured outputs): every field is required, optional values are
`X | None` without a default, additionalProperties is false on every object, and no unsupported
keywords (no min/max, length, pattern or format constraints). Ranges such as confidence in [0, 1]
are enforced by validate.py, not by the schema.

Refs are short refs only: t1..tN (tabs), q1..qN (search families), n1..nN (user notes),
d1..dN (document spans, Work Context only). The server maps them back (features.DataBlock.refs).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

Provenance = Literal["stated", "sourced", "inferred", "hypothesis"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EvidenceRef(_Strict):
    ref: str
    why: str


class GoalOut(_Strict):
    text: str
    provenance: Provenance
    confidence: float
    evidence: list[EvidenceRef]


class BranchOut(_Strict):
    branch_ref: str
    label: str
    tab_refs: list[str]
    status: Literal["active", "explored"]


class DirectionOut(_Strict):
    text: str
    provenance: Provenance
    confidence: float
    evidence: list[EvidenceRef]


class DecisionOut(_Strict):
    text: str
    provenance: Provenance
    user_note_ref: str | None
    quote: str | None
    confidence: float
    evidence: list[EvidenceRef]


class QuestionOut(_Strict):
    question: str
    kind: Literal["repeated_search", "unresolved_comparison", "dormant_mid_comparison"]
    provenance: Provenance
    confidence: float
    evidence: list[EvidenceRef]


class BlockerOut(_Strict):
    text: str
    provenance: Provenance
    confidence: float
    evidence: list[EvidenceRef]


class NextActionOut(_Strict):
    action: str
    unblocks_question: int | None  # index into unresolved_questions
    reason: str
    provenance: Provenance
    confidence: float
    evidence: list[EvidenceRef]


class RedundantGroupOut(_Strict):
    tab_refs: list[str]
    keep_ref: str
    reason: str


class HypothesisOut(_Strict):
    text: str
    provenance: Provenance
    confidence: float
    evidence: list[EvidenceRef]


class ClusterInference(_Strict):
    project_name: str
    goal: GoalOut
    branches: list[BranchOut]
    current_direction: DirectionOut | None
    decisions: list[DecisionOut]
    unresolved_questions: list[QuestionOut]
    blockers: list[BlockerOut]
    next_actions: list[NextActionOut]
    redundant_groups: list[RedundantGroupOut]
    important_tab_refs: list[str]
    hypotheses: list[HypothesisOut]
