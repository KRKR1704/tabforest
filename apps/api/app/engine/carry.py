"""What a grow carries over from the user's earlier actions on the same project (R-10, proposal §5, §17, §27).

Every grow creates new claim rows, so the user's corrections live in rules the server applies after
the model: the model never has the final word, and a re-grow never undoes what the user did.

- Notes: a `goal` note makes the tree's goal stated (clearing the fog, confirming or editing a goal);
  a `decision` note is always a carved stone (confirming or editing a decision).
- Dismissals: a claim the user dismissed is not suggested again. Chosen approach: BOTH the dismissed
  texts are passed to the model ("dismissed_by_user": do not repeat) AND any model claim that is
  similar to a dismissed text is dropped by code (similar(): term overlap on crude stems), because
  the model rewrites its wording on every run.
- Resolved questions: a question the user resolved stays resolved (a flower) when the same open loop
  comes back: matched by the search family it cites, else by text similarity.
- Names: a project the user created (assign to a new tree, clear the fog) keeps its name.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from uuid import UUID

log = logging.getLogger("tabforest.engine.carry")

_STOP = {"the", "and", "for", "with", "that", "this", "are", "was", "you", "your", "but", "not", "can", "how", "what",
         "where", "which", "when", "into", "from", "than", "then", "may", "maybe", "likely", "appears", "about",
         "should", "would", "could", "its", "has", "have", "had", "been", "being", "over", "also", "more", "most",
         "some", "any", "all", "user", "better", "best", "between", "versus", "use", "using"}
_SUFFIXES = ("ing", "ed", "es", "s", "e")
SIMILAR_JACCARD = 0.5
SIMILAR_CONTAINMENT = 0.75
SIMILAR_CONTAINMENT_MIN_TERMS = 3


def claim_terms(text: str) -> frozenset[str]:
    """Content terms of a claim, crudely stemmed (prefer/preferring/preferred -> prefer)."""
    out = set()
    for w in re.findall(r"[a-z0-9]+", (text or "").lower()):
        if len(w) < 3 or w in _STOP:
            continue
        for suffix in _SUFFIXES:
            if w.endswith(suffix) and len(w) - len(suffix) >= 4:
                w = w[:-len(suffix)]
                break
        out.add(w)
    return frozenset(out)


def similar(a: str, b: str, *, jaccard: float = SIMILAR_JACCARD, containment: float = SIMILAR_CONTAINMENT) -> bool:
    """Same claim in different words: Jaccard >= 0.5 of the content terms, or one contains >= 75 % of the other.
    The thresholds can be lowered by a caller that has a second signal (Work Context: a shared document)."""
    ta, tb = claim_terms(a), claim_terms(b)
    if not ta or not tb:
        return False
    inter = len(ta & tb)
    return (inter / len(ta | tb) >= jaccard
            or (min(len(ta), len(tb)) >= SIMILAR_CONTAINMENT_MIN_TERMS and inter / min(len(ta), len(tb)) >= containment))


@dataclass
class NoteRow:
    id: str            # api id, n_<uuid>
    kind: str          # goal | decision | note
    text: str
    tab_ref: str | None = None
    created_at: str = ""


@dataclass
class ResolvedQuestion:
    text: str
    answer: str
    resolved_at: str
    family_ids: frozenset[str] = frozenset()
    recurrence: int = 1
    kind: str = "repeated_search"


@dataclass
class Carry:
    project_id: str | None = None
    project_name: str | None = None
    user_named: bool = False
    notes: list[NoteRow] = field(default_factory=list)
    dismissed: list[str] = field(default_factory=list)
    resolved: list[ResolvedQuestion] = field(default_factory=list)

    def goal_note(self, tab_refs: set[str] | None = None) -> NoteRow | None:
        """The latest goal note of the project (or of a tab in this cluster)."""
        goals = [n for n in self.notes if n.kind == "goal" and (n.tab_ref is None or not tab_refs or n.tab_ref in tab_refs)]
        return goals[-1] if goals else None

    def decision_notes(self) -> list[NoteRow]:
        return [n for n in self.notes if n.kind == "decision"]

    def is_dismissed(self, text: str) -> bool:
        return any(similar(text, d) for d in self.dismissed)

    def covered_by_note(self, text: str) -> bool:
        """The user already said it (a decision or goal note): a weaker inferred copy is redundant."""
        return any(similar(text, n.text) for n in self.notes if n.kind in ("decision", "goal"))

    def match_resolved(self, text: str, family_ids: set[str] | frozenset[str],
                       taken: set[int] | None = None) -> ResolvedQuestion | None:
        """The resolved question this open loop is. With `taken`, each resolved question is used once, so
        two new questions about one loop do not both come back as flowers."""
        for i, r in enumerate(self.resolved):
            if taken is not None and i in taken:
                continue
            if r.family_ids & family_ids or similar(text, r.text):
                if taken is not None:
                    taken.add(i)
                return r
        return None


async def load_carry(pool, user_id: UUID, project_id: str | None) -> Carry:
    """Carry-over for a matched existing project; empty for a new one or without a database."""
    if pool is None or not project_id:
        return Carry()
    pid = UUID(project_id)
    try:
        project = await pool.fetchrow(
            "SELECT p.name, EXISTS (SELECT 1 FROM intent_clusters ic WHERE ic.user_id = p.user_id AND "
            "ic.project_id = p.id AND ic.analysis_run_id IS NULL) AS user_named "
            "FROM projects p WHERE p.id = $1 AND p.user_id = $2", pid, user_id)
        if project is None:
            return Carry()
        notes = await pool.fetch(
            "SELECT id::text AS id, kind, text, tab_ref::text AS tab_ref, created_at "
            "FROM user_notes WHERE user_id = $1 AND project_id = $2 ORDER BY created_at, id", user_id, pid)
        dismissed = await pool.fetch(
            "SELECT d.text FROM decisions d JOIN intent_clusters ic ON ic.id = d.cluster_id AND ic.user_id = d.user_id "
            "WHERE d.user_id = $1 AND ic.project_id = $2 AND d.dismissed_at IS NOT NULL "
            "UNION ALL SELECT q.question FROM unresolved_questions q JOIN intent_clusters ic ON ic.id = q.cluster_id "
            "AND ic.user_id = q.user_id WHERE q.user_id = $1 AND ic.project_id = $2 AND q.dismissed_at IS NOT NULL "
            "UNION ALL SELECT a.action FROM suggested_actions a JOIN intent_clusters ic ON ic.id = a.cluster_id "
            "AND ic.user_id = a.user_id WHERE a.user_id = $1 AND ic.project_id = $2 AND a.status = 'dismissed' "
            "LIMIT 100", user_id, pid)
        resolved = await pool.fetch(
            "SELECT q.question, q.answer, q.resolved_at, q.evidence, q.recurrence, q.kind "
            "FROM unresolved_questions q JOIN intent_clusters ic ON ic.id = q.cluster_id AND ic.user_id = q.user_id "
            "WHERE q.user_id = $1 AND ic.project_id = $2 AND q.status = 'resolved' AND q.dismissed_at IS NULL "
            "ORDER BY q.resolved_at DESC LIMIT 50", user_id, pid)
    except Exception as exc:  # noqa: BLE001 - carry-over is best effort; a grow still works without it
        log.warning("carry-over unavailable (%s)", type(exc).__name__)
        return Carry()
    out = Carry(project_id=project_id, project_name=project["name"], user_named=bool(project["user_named"]))
    out.notes = [NoteRow("n_" + r["id"], r["kind"], r["text"], r["tab_ref"], r["created_at"].isoformat()) for r in notes]
    out.dismissed = [r["text"] for r in dismissed]
    for r in resolved:  # newest first; every re-grow stored a copy of the flower: keep one per question
        evidence = json.loads(r["evidence"]) if isinstance(r["evidence"], str) else (r["evidence"] or [])
        item = ResolvedQuestion(r["question"], r["answer"] or "", r["resolved_at"].isoformat(),
                                frozenset(e["ref"] for e in evidence if e.get("ref_kind") == "query"), r["recurrence"],
                                r["kind"] or "repeated_search")
        if not any(item.family_ids & seen.family_ids or similar(item.text, seen.text) for seen in out.resolved):
            out.resolved.append(item)
    return out
