"""Persistence for grow runs (R-8, proposal §12 step 9): one transaction per run.

Writes R's tables (projects, intent_clusters, intent_branches, cluster_tabs, decisions,
unresolved_questions, suggested_actions, analysis_runs) and R's columns of P's `tabs`
(title_norm, source_type) with UPDATE only. Every statement filters or stamps user_id.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any
from uuid import UUID

import asyncpg

from .normalize import normalize_tab

if TYPE_CHECKING:
    from .grove import GrowRun

log = logging.getLogger("tabforest.engine.persist")

# Daily budget per user (§4.9): tokens (analysis_runs.tokens, migration 202), with the LLM-call count
# as a secondary cap. One demo grow is about 12k tokens and 5 calls, so 200k tokens ≈ 16 grows a day.
DAILY_TOKEN_BUDGET = 200_000
DAILY_LLM_CALL_BUDGET = 400


def _u(api_id: str | None) -> UUID | None:
    if not api_id:
        return None
    return UUID(api_id.split("_", 1)[1] if "_" in api_id[:5] else api_id)


def _j(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


async def usage_today(pool: Any, user_id: UUID) -> tuple[int, int]:
    """(tokens, llm_calls) of the user's runs since midnight UTC. Runs without a token count add 0 tokens."""
    if pool is None:
        return 0, 0
    try:
        row = await pool.fetchrow(
            "SELECT coalesce(sum(tokens), 0) AS tokens, coalesce(sum(llm_calls), 0) AS calls FROM analysis_runs "
            "WHERE user_id = $1 AND ts >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'", user_id)
    except asyncpg.UndefinedTableError:
        return 0, 0
    return int(row["tokens"]), int(row["calls"])


def budget_exceeded(tokens: int, calls: int) -> str | None:
    if tokens >= DAILY_TOKEN_BUDGET:
        return f"Daily AI budget of {DAILY_TOKEN_BUDGET} tokens reached; try again tomorrow"
    if calls >= DAILY_LLM_CALL_BUDGET:
        return f"Daily AI budget of {DAILY_LLM_CALL_BUDGET} model calls reached; try again tomorrow"
    return None


async def last_grove(pool: Any, user_id: UUID) -> dict[str, Any] | None:
    row = await pool.fetchval(
        "SELECT response FROM analysis_runs WHERE user_id = $1 AND kind = 'grow' AND response IS NOT NULL "
        "ORDER BY ts DESC LIMIT 1", user_id)
    return json.loads(row) if row else None


async def persist_run(run: GrowRun) -> None:
    pool, user = run.pool, run.user_id
    if pool is None:
        log.warning("grow run %s not persisted: no database", run.run_id)
        return
    r = run.report
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            "INSERT INTO analysis_runs (run_id, user_id, kind, clusters, model, latency_ms, llm_calls, tokens, "
            "downgraded_claims, fallback_used, degraded, hollow_count, response) "
            "VALUES ($1, $2, 'grow', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)",
            UUID(run.run_id), user, len(run.builds), run.model_name, r.latency_ms, r.llm_calls, r.tokens,
            len(r.downgrades), bool(r.fallbacks), run.response["degraded"], run.hollow_count, _j(run.response))

        for b in run.builds:
            t = b.tree
            pid = await conn.fetchval(
                "INSERT INTO projects (id, user_id, name, last_active_at) VALUES ($1, $2, $3, now()) "
                "ON CONFLICT (id) DO UPDATE SET last_active_at = now(), status = 'active' "
                "WHERE projects.user_id = excluded.user_id RETURNING id", UUID(b.project_id), user, t["name"])
            if pid is None:
                raise PermissionError("project id belongs to another user")
            goal = t["goal"]
            cluster_id = await conn.fetchval(
                "INSERT INTO intent_clusters (user_id, project_id, analysis_run_id, label, matched_existing, goal_id, "
                "goal, goal_provenance, goal_confidence, goal_evidence, goal_user_note_id, direction, hypotheses, "
                "vines, query_families, important_tab_refs, fogged) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, "
                "$10::jsonb, $11, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::uuid[], $17) RETURNING id",
                user, pid, UUID(run.run_id), b.label, b.matched_existing, _u(goal["id"]), goal["text"],
                goal["provenance"], goal["confidence"], _j(goal["evidence"]), _u(goal["user_note_id"]),
                _j(t["direction"]) if t["direction"] else None, _j(t["hypotheses"]), _j(t["vines"]),
                _j(t["query_families"]), [UUID(x) for x in t["important_tab_refs"]], t["fogged"])

            pinned = set(b.pinned_tab_refs)
            for position, branch in enumerate(t["branches"]):
                branch_id = await conn.fetchval(
                    "INSERT INTO intent_branches (user_id, cluster_id, label, status, position) "
                    "VALUES ($1, $2, $3, $4, $5) RETURNING id", user, cluster_id, branch["label"], branch["status"],
                    position)
                await conn.executemany(
                    "INSERT INTO cluster_tabs (user_id, cluster_id, branch_id, tab_ref, importance, assigned_by, "
                    "fallen, position) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) "
                    "ON CONFLICT (cluster_id, tab_ref) DO UPDATE SET branch_id = excluded.branch_id, "
                    "importance = excluded.importance, fallen = excluded.fallen, position = excluded.position "
                    "WHERE cluster_tabs.assigned_by <> 'user'",  # a user's assignment is never overwritten
                    [(user, cluster_id, branch_id, UUID(leaf["tab_ref"]), leaf["importance"],
                      "user" if leaf["tab_ref"] in pinned else "ai", leaf["fallen"], i)
                     for i, leaf in enumerate(branch["leaves"])])

            await conn.executemany(
                "INSERT INTO decisions (id, user_id, cluster_id, text, provenance, confidence, evidence, user_note_id, "
                "quote) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)",
                [(_u(d["id"]), user, cluster_id, d["text"], d["provenance"], d["confidence"], _j(d["evidence"]),
                  _u(d["user_note_id"]), d["quote"]) for d in b.decisions])
            await conn.executemany(
                "INSERT INTO unresolved_questions (id, user_id, cluster_id, question, kind, provenance, confidence, "
                "evidence, recurrence, user_note_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)",
                [(_u(q["id"]), user, cluster_id, q["text"], q["kind"], q["provenance"], q["confidence"],
                  _j(q["evidence"]), q["recurrence"], _u(q["user_note_id"])) for q in b.questions + b.blockers])
            await conn.executemany(
                "INSERT INTO suggested_actions (id, user_id, cluster_id, kind, action, reason, unblocks_question_id, "
                "provenance, confidence, evidence, user_note_id) "
                "VALUES ($1, $2, $3, 'next_action', $4, $5, $6, $7, $8, $9::jsonb, $10)",
                [(_u(a["id"]), user, cluster_id, a["text"], a["reason"], _u(a["unblocks"]), a["provenance"],
                  a["confidence"], _j(a["evidence"]), _u(a["user_note_id"])) for a in b.actions])

        # R's columns of P's tabs: UPDATE only; skipped if P's table or columns are missing.
        rows = []
        for tab in run.tabs:
            n = normalize_tab(tab)
            rows.append((user, UUID(n.tab_ref), n.title_norm, n.source_type.value))
        try:
            async with conn.transaction():
                await conn.executemany(
                    "UPDATE tabs SET title_norm = $3, source_type = $4 WHERE user_id = $1 AND tab_ref = $2", rows)
        except (asyncpg.UndefinedTableError, asyncpg.UndefinedColumnError) as exc:
            log.warning("tabs columns not updated (%s)", type(exc).__name__)
