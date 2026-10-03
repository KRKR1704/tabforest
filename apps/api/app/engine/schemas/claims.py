"""Claims, assign, notes and project analyze (contracts/claims.example.json).

PATCH /api/claims/{id} returns the updated claim in its grove shape (Stone, NextAction or
Mushroom), or ClaimDismissed. POST /api/projects/{id}/analyze returns one grove Tree.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from .common import Claim, Strict, TabRef


class ClaimPatchRequest(Strict):
    action: Literal["confirm", "edit", "dismiss", "resolve"]
    text: str | None = Field(default=None, min_length=1, max_length=500)
    answer: str | None = Field(default=None, min_length=1, max_length=2000)

    @model_validator(mode="after")
    def _fields_match_action(self) -> ClaimPatchRequest:
        if (self.action == "edit") != (self.text is not None):
            raise ValueError("text is required for edit and not allowed otherwise")
        if (self.action == "resolve") != (self.answer is not None):
            raise ValueError("answer is required for resolve and not allowed otherwise")
        return self


class ClaimDismissed(Strict):
    id: str
    status: Literal["dismissed"]
    dismissed_at: datetime


class AssignRequest(Strict):
    project_id: str | None = None
    branch_label: str | None = Field(default=None, min_length=1, max_length=80)
    new_project_name: str | None = Field(default=None, min_length=1, max_length=120)

    @model_validator(mode="after")
    def _one_target(self) -> AssignRequest:
        if (self.project_id is None) == (self.new_project_name is None):
            raise ValueError("give exactly one of project_id or new_project_name")
        if self.branch_label is not None and self.project_id is None:
            raise ValueError("branch_label needs project_id")
        return self


class AssignResponse(Strict):
    tab_ref: str
    from_project_id: str
    project_id: str
    project_name: str
    branch_label: str | None
    assigned_by: Literal["user"]
    pinned: bool
    reanalyze_project_ids: list[str]


class NoteCreateRequest(Strict):
    """'Clear the fog': the user names a goal (or records a decision or note)."""

    kind: Literal["goal", "decision", "note"]
    text: str = Field(min_length=1, max_length=2000)
    tab_ref: TabRef | None = None
    project_id: str | None = None

    @model_validator(mode="after")
    def _has_target(self) -> NoteCreateRequest:
        if self.tab_ref is None and self.project_id is None:
            raise ValueError("give tab_ref or project_id")
        return self


class Note(Strict):
    id: str
    kind: Literal["goal", "decision", "note"]
    tab_ref: str | None
    text: str
    created_at: datetime


class NoteCreateResponse(Strict):
    note: Note
    project_id: str
    claim: Claim
