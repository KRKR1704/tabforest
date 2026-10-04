"""Research memory (R-12): the insight writer, the dormancy pass, and GET /api/memory/search.

An insight is one finished stretch of research on a project, written from VALIDATED rows only (stated decisions,
explored branches, open questions and dismissed options that carry evidence), with a deterministic summary: no model
call. It is embedded (kind 'insight', source_id = insight id) and found again by cosine similarity, with the one
threshold PRIOR_RESEARCH_THRESHOLD that the firefly in the grove uses too (infer.py, calibrated in R-12).

Triggers (run_memory_pass): (a) a project dormant for 30 minutes with no insight since its last activity; (b) a
saved context (P's table, through adapters/contexts) whose project has no insight for its period. One insight per
project per dormancy period: an insight created at or after projects.last_active_at covers that period. A Postgres
advisory lock keeps several App Service workers from writing twice.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

from . import db
from .adapters.contexts import ContextsSource, get_contexts_source
from .adapters.stats import StatsSource, get_stats_source
from .aoai import AzureOpenAIClient
from .embeddings import _to_pgvector, embed_queries, embed_texts
from .infer import PRIOR_RESEARCH_THRESHOLD
from .schemas.common import Claim, Evidence
from .schemas.memory import MemoryMatch, MemorySearchResponse

log = logging.getLogger("tabforest.engine.memory")

DORMANT_AFTER = timedelta(minutes=30)
PASS_INTERVAL_S = 300
CONTEXT_WINDOW = timedelta(days=1)  # trigger (b) looks at contexts saved in the last day
MAX_MATCHES = 3
MAX_COMPARED = 6
MAX_LISTED = 5
CANDIDATE_LIMIT = 200
LOCK_KEY = 0x7466_6D65_6D31  # pg_try_advisory_lock key: "tfmem1"
NOT_FOUND = "No related research found"


def _utc(ts: datetime) -> datetime:
    return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------------------------------
# Summary text (deterministic)
# ---------------------------------------------------------------------------------------

def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def summary_text(name: str, compared: list[str], conclusion: str | None, rejected: list[str],
                 open_questions: list[str]) -> str:
    """'Researched X. Compared A and B. Concluded that ... Rejected ... Still open: ...' from validated parts only."""
    parts = [f"Researched {name}."]
    if len(compared) >= 2:
        parts.append(f"Compared {_join(compared)}.")
    elif compared:
        parts.append(f"Looked at {compared[0]}.")
    if conclusion:
        parts.append(f"Concluded that {conclusion}.")
    if rejected:
        parts.append(f"Rejected {_join(rejected)}.")
    if open_questions:
        parts.append("Still open: " + "; ".join(open_questions) + ".")
    return " ".join(parts)


# ---------------------------------------------------------------------------------------
# The insight writer
# ---------------------------------------------------------------------------------------

@dataclass
class WriteResult:
    status: str  # written | exists | nothing | embed_failed | missing
    insight_id: UUID | None = None


async def _gather(pool: Any, user_id: UUID, project_id: UUID) -> dict[str, Any]:
    """Validated rows of one project. Every statement filters on user_id."""
    refs = await pool.fetch(
        "SELECT DISTINCT ct.tab_ref::text AS ref FROM cluster_tabs ct JOIN intent_clusters ic ON ic.id = ct.cluster_id "
        "WHERE ct.user_id = $1 AND ic.user_id = $1 AND ic.project_id = $2", user_id, project_id)
    branches = await pool.fetch(
        "SELECT ib.label FROM intent_branches ib JOIN intent_clusters ic ON ic.id = ib.cluster_id "
        "WHERE ib.user_id = $1 AND ic.user_id = $1 AND ic.project_id = $2 AND ib.status = 'explored' "
        "ORDER BY ib.position, ib.created_at", user_id, project_id)
    stated = await pool.fetchrow(
        "SELECT d.id, d.text, d.confidence, d.evidence, d.user_note_id FROM decisions d "
        "JOIN intent_clusters ic ON ic.id = d.cluster_id WHERE d.user_id = $1 AND ic.user_id = $1 AND ic.project_id = $2 "
        "AND d.provenance = 'stated' AND d.user_note_id IS NOT NULL AND d.dismissed_at IS NULL "
        "ORDER BY d.created_at DESC LIMIT 1", user_id, project_id)
    rejected = await pool.fetch(
        "SELECT d.text, d.evidence FROM decisions d JOIN intent_clusters ic ON ic.id = d.cluster_id "
        "WHERE d.user_id = $1 AND ic.user_id = $1 AND ic.project_id = $2 AND d.dismissed_at IS NOT NULL "
        "AND jsonb_array_length(d.evidence) > 0 ORDER BY d.dismissed_at LIMIT $3", user_id, project_id, MAX_LISTED)
    questions = await pool.fetch(
        "SELECT q.question, q.provenance, q.evidence FROM unresolved_questions q "
        "JOIN intent_clusters ic ON ic.id = q.cluster_id WHERE q.user_id = $1 AND ic.user_id = $1 AND ic.project_id = $2 "
        "AND q.status = 'open' AND q.dismissed_at IS NULL AND jsonb_array_length(q.evidence) > 0 "
        "ORDER BY q.recurrence DESC, q.created_at LIMIT $3", user_id, project_id, MAX_LISTED)
    return {"refs": {r["ref"] for r in refs}, "branches": [r["label"] for r in branches], "stated": stated,
            "rejected": rejected, "questions": questions}


def _json(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


def _distinct(items: list[str], limit: int) -> list[str]:
    seen: dict[str, None] = {}
    for item in items:
        seen.setdefault(item.strip(), None)
    return [i for i in seen if i][:limit]


def _stated_claim(row: Any) -> dict[str, Any]:
    evidence = _json(row["evidence"]) or [{"ref_kind": "note", "ref": f"n_{row['user_note_id']}", "why": "user note"}]
    return {"id": f"dec_{row['id']}", "text": row["text"], "provenance": "stated", "confidence": 1.0,
            "display_text": row["text"], "user_note_id": f"n_{row['user_note_id']}", "evidence": evidence}


async def write_insight(pool: Any, user_id: UUID, project_id: UUID, *, stats: StatsSource | None = None,
                        contexts: ContextsSource | None = None, client: AzureOpenAIClient | None = None) -> WriteResult:
    """Write (and embed) the insight for the project's current dormancy period, once.

    'exists' when this period already has one (its saved context is linked if it was missing); 'nothing' when the
    project has no validated compared options, stated decision or open question to say.
    """
    stats = stats or get_stats_source(pool)
    contexts = contexts or get_contexts_source(pool)
    project = await pool.fetchrow("SELECT name, created_at, last_active_at FROM projects WHERE id = $1 AND user_id = $2",
                                  project_id, user_id)
    if project is None:
        return WriteResult("missing")
    last_active = project["last_active_at"]
    context = next((c for c in await contexts.saved_contexts(user_id) if c.project_id == f"p_{project_id}"), None)
    context_id = UUID(context.id.removeprefix("s_")) if context else None

    existing = await pool.fetchrow(
        "SELECT id, saved_context_id FROM research_insights WHERE user_id = $1 AND project_id = $2 "
        "AND ($3::timestamptz IS NULL OR created_at >= $3) ORDER BY created_at DESC LIMIT 1", user_id, project_id,
        last_active)
    if existing is not None:
        if existing["saved_context_id"] is None and context_id is not None:
            await pool.execute("UPDATE research_insights SET saved_context_id = $3 WHERE id = $1 AND user_id = $2",
                               existing["id"], user_id, context_id)
        return WriteResult("exists", existing["id"])

    g = await _gather(pool, user_id, project_id)
    compared = _distinct(g["branches"], MAX_COMPARED)
    conclusion = _stated_claim(g["stated"]) if g["stated"] else None
    rejected = [{"option": r["text"], "reason": "dismissed by the user", "evidence": _json(r["evidence"])}
                for r in g["rejected"]]
    open_questions = [{"question": q["question"], "provenance": q["provenance"], "evidence": _json(q["evidence"])}
                      for q in g["questions"]]
    if not (len(compared) >= 2 or conclusion or open_questions):
        return WriteResult("nothing")

    events = await stats.events(user_id, g["refs"]) if g["refs"] else []
    start = min((e.ts for e in events), default=project["created_at"])
    end = max((e.ts for e in events), default=last_active or project["created_at"])
    summary = summary_text(project["name"], compared, conclusion["text"] if conclusion else None,
                           [r["option"] for r in rejected], [q["question"] for q in open_questions])
    insight_id = uuid4()
    await pool.execute(
        "INSERT INTO research_insights (id, user_id, project_id, saved_context_id, summary, compared, conclusion, "
        "rejected, open_questions, period_start, period_end) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, "
        "$9::jsonb, $10, $11)", insight_id, user_id, project_id, context_id, summary, compared,
        json.dumps(conclusion) if conclusion else None, json.dumps(rejected), json.dumps(open_questions),
        _utc(start), _utc(end))
    try:
        await embed_texts(user_id, "insight", [(str(insight_id), summary)], pool, client=client)
    except Exception as exc:  # noqa: BLE001 - an insight nobody can find is worse than none: retry next pass
        log.warning("memory: embedding failed (%s); insight %s removed", type(exc).__name__, insight_id)
        await pool.execute("DELETE FROM research_insights WHERE id = $1 AND user_id = $2", insight_id, user_id)
        return WriteResult("embed_failed")
    return WriteResult("written", insight_id)


# ---------------------------------------------------------------------------------------
# The pass (background task) with the advisory lock
# ---------------------------------------------------------------------------------------

@dataclass
class PassResult:
    locked_out: bool = False
    written: list[UUID] = field(default_factory=list)
    checked: int = 0


async def _last_focus(stats: StatsSource, user_id: UUID, refs: set[str]) -> datetime | None:
    if not refs:
        return None
    return max((a.last_focus for a in (await stats.attention(user_id, refs)).values() if a.last_focus), default=None)


async def run_memory_pass(pool: Any, *, stats: StatsSource | None = None, contexts: ContextsSource | None = None,
                          client: AzureOpenAIClient | None = None, now: datetime | None = None,
                          user_id: UUID | None = None) -> PassResult:
    """One pass over (a) dormant projects and (b) fresh saved contexts, of every user or of `user_id` only.
    Skips if another worker holds the lock."""
    stats = stats or get_stats_source(pool)
    contexts = contexts or get_contexts_source(pool)
    now = _utc(now or datetime.now(timezone.utc))
    result = PassResult()
    conn = await pool.acquire()
    try:
        if not await conn.fetchval("SELECT pg_try_advisory_lock($1)", LOCK_KEY):
            result.locked_out = True
            return result
        try:
            candidates: dict[tuple[UUID, UUID], bool] = {}  # (user, project) -> needs the dormancy check
            rows = await pool.fetch(
                "SELECT p.user_id, p.id FROM projects p WHERE p.last_active_at IS NOT NULL AND p.last_active_at <= $1 "
                "AND NOT EXISTS (SELECT 1 FROM research_insights ri WHERE ri.user_id = p.user_id "
                "AND ri.project_id = p.id AND ri.created_at >= p.last_active_at) AND ($3::uuid IS NULL OR p.user_id = $3) "
                "ORDER BY p.last_active_at DESC LIMIT $2", now - DORMANT_AFTER, CANDIDATE_LIMIT, user_id)
            for r in rows:
                candidates[(r["user_id"], r["id"])] = True
            for ctx in await contexts.recent(now - CONTEXT_WINDOW):
                if ctx.user_id is not None and ctx.project_id and user_id in (None, ctx.user_id):
                    candidates.setdefault((ctx.user_id, UUID(ctx.project_id.removeprefix("p_"))), False)
            for (user_id, project_id), needs_dormancy in candidates.items():
                result.checked += 1
                try:
                    if needs_dormancy:
                        refs = {r["ref"] for r in await pool.fetch(
                            "SELECT DISTINCT ct.tab_ref::text AS ref FROM cluster_tabs ct JOIN intent_clusters ic "
                            "ON ic.id = ct.cluster_id WHERE ct.user_id = $1 AND ic.user_id = $1 AND ic.project_id = $2",
                            user_id, project_id)}
                        focus = await _last_focus(stats, user_id, refs)
                        if focus is not None and now - _utc(focus) < DORMANT_AFTER:
                            continue
                    written = await write_insight(pool, user_id, project_id, stats=stats, contexts=contexts,
                                                  client=client)
                    if written.status == "written" and written.insight_id:
                        result.written.append(written.insight_id)
                except Exception as exc:  # noqa: BLE001 - one project never stops the pass
                    log.warning("memory: project skipped (%s)", type(exc).__name__)
        finally:
            await conn.execute("SELECT pg_advisory_unlock($1)", LOCK_KEY)
    finally:
        await pool.release(conn)
    return result


async def memory_loop(interval_s: float = PASS_INTERVAL_S) -> None:
    """Every 5 minutes until cancelled, first pass after one interval (starting the app never writes at once).
    P's lifespan starts it: asyncio.create_task(memory_loop())."""
    while True:
        await asyncio.sleep(interval_s)
        try:
            pool = await db.get_pool()
            if pool is not None:
                done = await run_memory_pass(pool)
                if done.written:
                    log.info("memory: %d insight(s) written", len(done.written))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("memory: pass failed (%s)", type(exc).__name__)


# ---------------------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------------------

def _stated_conclusion(stored: Any, period_end: date | None) -> Claim | None:
    """The stored conclusion as a claim, only when it is a real stated decision (provenance + the user's own note)."""
    stored = _json(stored)
    if not stored or stored.get("provenance") != "stated" or not stored.get("user_note_id"):
        return None
    when = f"user note, {period_end:%B} {period_end.day}" if period_end else "user note"
    evidence = stored.get("evidence") or [{"ref_kind": "note", "ref": stored["user_note_id"], "why": when}]
    return Claim(id=stored["id"], text=stored["text"], provenance="stated", confidence=float(stored.get("confidence", 1.0)),
                 display_text=stored.get("display_text") or stored["text"], user_note_id=stored["user_note_id"],
                 evidence=[Evidence(**e) for e in evidence])


async def search(pool: Any, user_id: UUID, query: str, *, stats: StatsSource | None = None,
                 client: AzureOpenAIClient | None = None) -> MemorySearchResponse:
    """Insights and saved contexts of THIS user nearest to the query, at or above the calibrated threshold."""
    stats = stats or get_stats_source(pool)
    vec = _to_pgvector((await embed_queries(user_id, [query], pool, client=client)).vectors[query])
    by_project: dict[str, dict[str, Any]] = {}
    insight_rows = await pool.fetch(
        "SELECT ri.project_id::text AS project_id, p.name, ri.compared, ri.conclusion, "
        "coalesce(ri.period_end, ri.created_at)::date AS on_date, ri.saved_context_id::text AS context_id, "
        "1 - (me.embedding <=> $2::vector) AS similarity FROM memory_embeddings me "
        "JOIN research_insights ri ON ri.id::text = me.source_id AND ri.user_id = me.user_id "
        "JOIN projects p ON p.id = ri.project_id AND p.user_id = ri.user_id "
        "WHERE me.user_id = $1 AND me.kind = 'insight' ORDER BY me.embedding <=> $2::vector LIMIT 10", user_id, vec)
    for r in insight_rows:
        by_project.setdefault(r["project_id"], {"name": r["name"], "compared": list(r["compared"]),
                                                "conclusion": r["conclusion"], "on": r["on_date"],
                                                "context_id": r["context_id"], "similarity": float(r["similarity"])})
    try:
        context_rows = await pool.fetch(
            "SELECT sc.project_id::text AS project_id, p.name, sc.id::text AS context_id, sc.saved_at::date AS on_date, "
            "1 - (me.embedding <=> $2::vector) AS similarity FROM memory_embeddings me "
            "JOIN saved_contexts sc ON sc.id::text = me.source_id AND sc.user_id = me.user_id "
            "JOIN projects p ON p.id = sc.project_id AND p.user_id = sc.user_id "
            "WHERE me.user_id = $1 AND me.kind = 'context' ORDER BY me.embedding <=> $2::vector LIMIT 10", user_id, vec)
    except Exception as exc:  # noqa: BLE001 - P's table may not be there yet; insights still answer
        log.warning("memory: saved contexts unavailable (%s)", type(exc).__name__)
        context_rows = []
    for r in context_rows:
        hit = by_project.get(r["project_id"])
        if hit is None:
            by_project[r["project_id"]] = {"name": r["name"], "compared": [], "conclusion": None, "on": r["on_date"],
                                           "context_id": r["context_id"], "similarity": float(r["similarity"])}
        else:
            hit["similarity"] = max(hit["similarity"], float(r["similarity"]))
            hit["context_id"] = hit["context_id"] or r["context_id"]

    matches: list[MemoryMatch] = []
    for project_id, hit in sorted(by_project.items(), key=lambda kv: -kv[1]["similarity"]):
        if hit["similarity"] < PRIOR_RESEARCH_THRESHOLD or len(matches) == MAX_MATCHES:
            continue
        refs = {r["ref"] for r in await pool.fetch(
            "SELECT DISTINCT ct.tab_ref::text AS ref FROM cluster_tabs ct JOIN intent_clusters ic ON ic.id = ct.cluster_id "
            "WHERE ct.user_id = $1 AND ic.user_id = $1 AND ic.project_id = $2::uuid", user_id, project_id)}
        ms = await stats.attention_ms(user_id, refs) if refs else 0
        matches.append(MemoryMatch(
            project_id=f"p_{project_id}", project=hit["name"], date=hit["on"],
            similarity=round(max(0.0, min(1.0, hit["similarity"])), 2), attention_min=round(ms / 60000),
            compared=hit["compared"], conclusion=_stated_conclusion(hit["conclusion"], hit["on"]),
            saved_context_id=f"s_{hit['context_id']}" if hit["context_id"] else None))
    if not matches:
        return MemorySearchResponse(found=False, query=query, message=NOT_FOUND, matches=[])
    return MemorySearchResponse(found=True, query=query, message=None, matches=matches)


def payload(response: MemorySearchResponse) -> dict[str, Any]:
    """The JSON of the contract: a match with no stated conclusion has no `conclusion` key at all."""
    body = response.model_dump(mode="json")
    for match in body["matches"]:
        if match["conclusion"] is None:
            del match["conclusion"]
    return body
