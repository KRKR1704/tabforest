"""GET /api/memory/search?q= (contracts/memory-search.example.json)."""

from __future__ import annotations

from datetime import date

from .common import Claim, Confidence, Strict


class MemoryMatch(Strict):
    project_id: str
    project: str
    date: date
    similarity: Confidence
    attention_min: int
    compared: list[str]
    conclusion: Claim
    saved_context_id: str | None


class MemorySearchResponse(Strict):
    found: bool
    query: str
    message: str | None
    matches: list[MemoryMatch]
