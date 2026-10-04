"""R-12 research memory, unit level: no database, no network (a fake pool, a fake stats source, embeddings patched).

The live round trip (real Azure OpenAI + Tiger Cloud) is tests/test_memory_live.py.
"""

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import numpy as np
import pytest
from pydantic import ValidationError

from app.engine import memory
from app.engine.adapters.contexts import SavedContext
from app.engine.adapters.stats import TabEvent
from app.engine.fixtures import load_contract
from app.engine.infer import PRIOR_RESEARCH_THRESHOLD
from app.engine.schemas import MemorySearchResponse

A = UUID("00000000-0000-4000-8000-0000000000a1")
B = UUID("00000000-0000-4000-8000-0000000000b1")
PROJECT = UUID("10000000-0000-4000-8000-000000000099")
CONTEXT = UUID("60000000-0000-4000-8000-000000000003")
NOTE = UUID("40000000-0000-4000-8000-000000000003")
DECISION = UUID("30000000-0000-4000-8000-000000000901")
TAB = "11111111-1111-4111-8111-111111111111"
NOW = datetime(2026, 10, 4, 12, 0, tzinfo=timezone.utc)
MARCH = datetime(2026, 3, 12, 20, 35, tzinfo=timezone.utc)
CONTRACT = {e["name"]: e["response"]["body"] for e in load_contract("memory-search.example.json")["examples"]}


class Conn:
    def __init__(self, pool: "FakePool") -> None:
        self.pool = pool

    async def fetchval(self, sql: str, *args: Any) -> Any:
        self.pool.calls.append(("lock", args))
        return not self.pool.lock_taken

    async def execute(self, sql: str, *args: Any) -> str:
        self.pool.calls.append(("unlock" if "unlock" in sql else "conn-exec", args))
        return "OK"


class FakePool:
    """Answers the memory queries from dicts keyed by user id; every query's first argument must be that user."""

    def __init__(self) -> None:
        self.projects: dict[UUID, dict] = {}        # user -> project row (one project per user is enough here)
        self.existing: dict[UUID, dict] = {}        # user -> latest insight row of the period
        self.branches: dict[UUID, list[str]] = {}
        self.stated: dict[UUID, dict] = {}
        self.rejected: dict[UUID, list[dict]] = {}
        self.questions: dict[UUID, list[dict]] = {}
        self.refs: dict[UUID, list[str]] = {}
        self.insight_hits: dict[UUID, list[dict]] = {}
        self.context_hits: dict[UUID, list[dict]] = {}
        self.inserted: list[tuple] = []
        self.deleted: list[tuple] = []
        self.updated: list[tuple] = []
        self.calls: list[tuple] = []
        self.lock_taken = False
        self.candidates: list[dict] = []

    async def fetchrow(self, sql: str, *args: Any) -> Any:
        user = args[0] if "FROM projects" not in sql else args[1]
        if "FROM projects" in sql:
            return self.projects.get(user)
        if "FROM research_insights" in sql:
            return self.existing.get(user)
        if "FROM decisions d" in sql:
            return self.stated.get(user)
        raise AssertionError(sql)

    async def fetch(self, sql: str, *args: Any) -> list[Any]:
        if "FROM projects p WHERE p.last_active_at" in sql:
            return self.candidates
        user = args[0]
        if "SELECT DISTINCT ct.tab_ref" in sql:
            return [{"ref": r} for r in self.refs.get(user, [])]
        if "FROM intent_branches" in sql:
            return [{"label": label} for label in self.branches.get(user, [])]
        if "d.dismissed_at IS NOT NULL" in sql:
            return self.rejected.get(user, [])
        if "FROM unresolved_questions" in sql:
            return self.questions.get(user, [])
        if "me.kind = 'insight'" in sql:
            return self.insight_hits.get(user, [])
        if "me.kind = 'context'" in sql:
            return self.context_hits.get(user, [])
        raise AssertionError(sql)

    async def execute(self, sql: str, *args: Any) -> str:
        if sql.startswith("INSERT INTO research_insights"):
            self.inserted.append(args)
        elif sql.startswith("DELETE FROM research_insights"):
            self.deleted.append(args)
        elif sql.startswith("UPDATE research_insights"):
            self.updated.append(args)
        return "OK"

    async def acquire(self) -> Conn:
        return Conn(self)

    async def release(self, conn: Conn) -> None:
        self.calls.append(("release", ()))


class FakeStats:
    def __init__(self, ms: int = 0, events: list[TabEvent] | None = None) -> None:
        self.ms, self._events = ms, events or []

    async def events(self, user_id: UUID, tab_refs: set[str], since: datetime | None = None) -> list[TabEvent]:
        return self._events

    async def attention(self, user_id: UUID, tab_refs: set[str], since: datetime | None = None) -> dict:
        return {}

    async def attention_ms(self, user_id: UUID, tab_refs: set[str]) -> int:
        return self.ms


class FakeContexts:
    def __init__(self, contexts: list[SavedContext] | None = None) -> None:
        self.contexts = contexts or []

    async def saved_contexts(self, user_id: UUID, since: datetime | None = None) -> list[SavedContext]:
        return [c for c in self.contexts if c.user_id in (None, user_id)]

    async def recent(self, since: datetime) -> list[SavedContext]:
        return self.contexts


def context(user: UUID = A) -> SavedContext:
    return SavedContext(id=f"s_{CONTEXT}", project_id=f"p_{PROJECT}", project_name="Backend Scaling", kind="resume",
                        title="Backend Scaling", saved_at=MARCH, last_active_at=MARCH, user_id=user)


def seeded(pool: FakePool, user: UUID = A, *, stated: bool = True) -> FakePool:
    pool.projects[user] = {"name": "Backend Scaling", "created_at": MARCH, "last_active_at": MARCH}
    pool.refs[user] = [TAB]
    pool.branches[user] = ["Redis", "Postgres sessions", "Redis"]
    if stated:
        pool.stated[user] = {"id": DECISION, "text": "Redis not needed at expected scale", "confidence": 1.0,
                             "evidence": [{"ref_kind": "note", "ref": f"n_{NOTE}", "why": "user note, March 12"}],
                             "user_note_id": NOTE}
    return pool


@pytest.fixture
def embedded(monkeypatch: pytest.MonkeyPatch) -> list[tuple]:
    calls: list[tuple] = []

    async def fake_embed_texts(user_id, kind, items, pool, **kwargs):
        calls.append((user_id, kind, list(items)))
        return SimpleNamespace(vectors={})

    monkeypatch.setattr(memory, "embed_texts", fake_embed_texts)
    return calls


def run(coro: Any) -> Any:
    return asyncio.run(coro)


# ---- summary text -----------------------------------------------------------------------------------------------

def test_summary_is_deterministic_and_only_says_what_it_has() -> None:
    full = memory.summary_text("Backend Scaling", ["Redis", "Postgres sessions"], "Redis not needed at expected scale",
                               ["Redis"], ["How many sessions?", "Who owns it?"])
    assert full == ("Researched Backend Scaling. Compared Redis and Postgres sessions. "
                    "Concluded that Redis not needed at expected scale. Rejected Redis. "
                    "Still open: How many sessions?; Who owns it?.")
    assert memory.summary_text("X", ["A"], None, [], []) == "Researched X. Looked at A."
    assert memory.summary_text("X", [], None, [], []) == "Researched X."
    assert memory.summary_text("X", ["A", "B", "C"], None, [], []).endswith("Compared A, B and C.")


# ---- the writer -------------------------------------------------------------------------------------------------

def test_writer_uses_validated_rows_and_embeds_the_insight(embedded: list[tuple]) -> None:
    pool = seeded(FakePool())
    pool.rejected[A] = [{"text": "Memcached", "evidence": [{"ref_kind": "tab", "ref": TAB, "why": "dismissed"}]}]
    pool.questions[A] = [{"question": "What is the session TTL?", "provenance": "inferred",
                          "evidence": [{"ref_kind": "query", "ref": "q", "why": "searched twice"}]}]
    events = [TabEvent(event_id="e1", ts=MARCH, type="FOCUS", tab_ref=TAB, session_id="s"),
              TabEvent(event_id="e2", ts=datetime(2026, 3, 12, 21, 0, tzinfo=timezone.utc), type="BLUR", tab_ref=TAB,
                       session_id="s", active_ms=1000)]
    done = run(memory.write_insight(pool, A, PROJECT, stats=FakeStats(events=events), contexts=FakeContexts([context()])))
    assert done.status == "written"
    (row,) = pool.inserted
    insight_id, user, project, context_id, summary, compared, conclusion, rejected, questions, start, end = row
    assert (user, project, context_id) == (A, PROJECT, CONTEXT)
    assert compared == ["Redis", "Postgres sessions"]                      # distinct, in branch order
    assert '"provenance": "stated"' in conclusion and f'"user_note_id": "n_{NOTE}"' in conclusion
    assert "Memcached" in rejected and "What is the session TTL?" in questions
    assert (start, end) == (MARCH, datetime(2026, 3, 12, 21, 0, tzinfo=timezone.utc))
    assert summary.startswith("Researched Backend Scaling. Compared Redis and Postgres sessions. Concluded that Redis")
    assert embedded == [(A, "insight", [(str(insight_id), summary)])]       # kind 'insight', source_id = insight id


def test_writer_leaves_out_the_conclusion_without_a_stated_decision(embedded: list[tuple]) -> None:
    pool = seeded(FakePool(), stated=False)
    assert run(memory.write_insight(pool, A, PROJECT, stats=FakeStats(), contexts=FakeContexts())).status == "written"
    assert pool.inserted[0][6] is None and "Concluded" not in pool.inserted[0][4]


def test_writer_writes_nothing_when_nothing_is_validated(embedded: list[tuple]) -> None:
    pool = seeded(FakePool(), stated=False)
    pool.branches[A] = ["Redis"]
    assert run(memory.write_insight(pool, A, PROJECT, stats=FakeStats(), contexts=FakeContexts())).status == "nothing"
    assert pool.inserted == [] and embedded == []


def test_writer_is_idempotent_per_dormancy_period(embedded: list[tuple]) -> None:
    pool = seeded(FakePool())
    existing = uuid4()
    pool.existing[A] = {"id": existing, "saved_context_id": None}
    done = run(memory.write_insight(pool, A, PROJECT, stats=FakeStats(), contexts=FakeContexts([context()])))
    assert (done.status, done.insight_id) == ("exists", existing)
    assert pool.inserted == [] and embedded == []
    assert pool.updated and pool.updated[0][2] == CONTEXT                    # the missing saved context gets linked


def test_writer_removes_an_insight_it_could_not_embed(monkeypatch: pytest.MonkeyPatch) -> None:
    async def boom(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("embeddings down")

    monkeypatch.setattr(memory, "embed_texts", boom)
    pool = seeded(FakePool())
    assert run(memory.write_insight(pool, A, PROJECT, stats=FakeStats(), contexts=FakeContexts())).status == "embed_failed"
    assert len(pool.deleted) == 1 and pool.deleted[0][0] == pool.inserted[0][0]


def test_writer_unknown_project_is_missing() -> None:
    assert run(memory.write_insight(FakePool(), B, PROJECT, stats=FakeStats(), contexts=FakeContexts())).status == "missing"


# ---- the pass and its lock --------------------------------------------------------------------------------------

def test_pass_does_nothing_when_another_worker_holds_the_lock(embedded: list[tuple]) -> None:
    pool = seeded(FakePool())
    pool.lock_taken = True
    pool.candidates = [{"user_id": A, "id": PROJECT}]
    done = run(memory.run_memory_pass(pool, stats=FakeStats(), contexts=FakeContexts([context()]), now=NOW))
    assert done.locked_out and done.checked == 0 and pool.inserted == []
    assert ("unlock", (memory.LOCK_KEY,)) not in pool.calls and ("release", ()) in pool.calls


def test_pass_writes_for_a_dormant_project_and_unlocks(embedded: list[tuple]) -> None:
    pool = seeded(FakePool())
    pool.candidates = [{"user_id": A, "id": PROJECT}]
    done = run(memory.run_memory_pass(pool, stats=FakeStats(), contexts=FakeContexts(), now=NOW))
    assert len(done.written) == 1 and done.checked == 1 and not done.locked_out
    assert ("unlock", (memory.LOCK_KEY,)) in pool.calls and ("release", ()) in pool.calls


def test_pass_skips_a_project_still_in_focus(embedded: list[tuple]) -> None:
    class Busy(FakeStats):
        async def attention(self, user_id: UUID, tab_refs: set[str], since: datetime | None = None) -> dict:
            return {TAB: SimpleNamespace(last_focus=NOW)}

    pool = seeded(FakePool())
    pool.candidates = [{"user_id": A, "id": PROJECT}]
    done = run(memory.run_memory_pass(pool, stats=Busy(), contexts=FakeContexts(), now=NOW))
    assert done.checked == 1 and done.written == [] and pool.inserted == []


def test_pass_writes_for_a_new_saved_context(embedded: list[tuple]) -> None:
    pool = seeded(FakePool())
    done = run(memory.run_memory_pass(pool, stats=FakeStats(), contexts=FakeContexts([context()]), now=NOW))
    assert len(done.written) == 1 and pool.inserted[0][3] == CONTEXT


# ---- search -----------------------------------------------------------------------------------------------------

@pytest.fixture
def query_embeddings(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake(user_id, queries, pool, **kwargs):
        return SimpleNamespace(vectors={q: np.ones(4, dtype=np.float32) for q in queries})

    monkeypatch.setattr(memory, "embed_queries", fake)


def insight_hit(similarity: float, *, conclusion: Any = "stated") -> dict:
    stored = {"id": f"dec_{DECISION}", "text": "Redis not needed at expected scale", "provenance": "stated",
              "confidence": 1.0, "user_note_id": f"n_{NOTE}"} if conclusion == "stated" else conclusion
    return {"project_id": str(PROJECT), "name": "Backend Scaling", "compared": ["Redis", "Postgres sessions"],
            "conclusion": stored, "on_date": MARCH.date(), "context_id": str(CONTEXT), "similarity": similarity}


def test_search_found_matches_the_contract_exactly(query_embeddings: None) -> None:
    pool = seeded(FakePool())
    pool.insight_hits[A] = [insight_hit(0.84)]
    got = run(memory.search(pool, A, "session storage", stats=FakeStats(ms=100 * 60_000)))
    body = memory.payload(got)
    assert body == CONTRACT["found: session storage"]
    MemorySearchResponse.model_validate(body)


def test_search_not_found_is_the_honest_contract_response(query_embeddings: None) -> None:
    pool = seeded(FakePool())
    pool.insight_hits[A] = [insight_hit(PRIOR_RESEARCH_THRESHOLD - 0.01)]
    body = memory.payload(run(memory.search(pool, A, "recipe", stats=FakeStats())))
    assert body == CONTRACT["not found: recipe"]
    assert memory.payload(run(memory.search(FakePool(), A, "recipe", stats=FakeStats()))) == CONTRACT["not found: recipe"]


def test_search_threshold_is_the_firefly_threshold(query_embeddings: None) -> None:
    pool = seeded(FakePool())
    pool.insight_hits[A] = [insight_hit(PRIOR_RESEARCH_THRESHOLD)]
    assert run(memory.search(pool, A, "x", stats=FakeStats())).found


def test_search_omits_the_conclusion_unless_it_is_a_real_stated_decision(query_embeddings: None) -> None:
    for stored in (None, {"id": "dec_x", "text": "Use Redis", "provenance": "inferred", "confidence": 0.6},
                   {"id": "dec_x", "text": "Use Redis", "provenance": "stated", "confidence": 1.0}):  # stated, no note
        pool = seeded(FakePool())
        pool.insight_hits[A] = [insight_hit(0.8, conclusion=stored)]
        (match,) = memory.payload(run(memory.search(pool, A, "redis", stats=FakeStats())))["matches"]
        assert "conclusion" not in match and match["compared"] == ["Redis", "Postgres sessions"]


def test_search_returns_at_most_three_best_first_and_merges_a_context_hit(query_embeddings: None) -> None:
    pool = seeded(FakePool())
    others = [{**insight_hit(s), "project_id": str(uuid4()), "name": f"P{s}"} for s in (0.5, 0.6, 0.7)]
    pool.insight_hits[A] = [insight_hit(0.4), *others]
    pool.context_hits[A] = [{"project_id": str(PROJECT), "name": "Backend Scaling", "context_id": str(CONTEXT),
                             "on_date": MARCH.date(), "similarity": 0.9}]
    matches = run(memory.search(pool, A, "redis", stats=FakeStats())).matches
    assert [m.similarity for m in matches] == [0.9, 0.7, 0.6]                # the 0.4 insight took the context's 0.9
    assert matches[0].project == "Backend Scaling" and matches[0].saved_context_id == f"s_{CONTEXT}"


def test_search_context_only_match_has_no_compared_or_conclusion(query_embeddings: None) -> None:
    pool = seeded(FakePool())
    pool.context_hits[A] = [{"project_id": str(PROJECT), "name": "Backend Scaling", "context_id": str(CONTEXT),
                             "on_date": MARCH.date(), "similarity": 0.5}]
    (match,) = memory.payload(run(memory.search(pool, A, "redis", stats=FakeStats())))["matches"]
    assert match["compared"] == [] and "conclusion" not in match and match["saved_context_id"] == f"s_{CONTEXT}"


def test_user_b_never_sees_user_a_insights(query_embeddings: None) -> None:
    pool = seeded(FakePool())
    pool.insight_hits[A] = [insight_hit(0.9)]
    assert run(memory.search(pool, A, "session storage", stats=FakeStats())).found
    other = run(memory.search(pool, B, "session storage", stats=FakeStats()))
    assert other.found is False and other.matches == [] and other.message == memory.NOT_FOUND   # empty, not an error


def test_contract_shape_rejects_drift() -> None:
    body = {**CONTRACT["not found: recipe"], "extra": 1}
    with pytest.raises(ValidationError):
        MemorySearchResponse.model_validate(body)
