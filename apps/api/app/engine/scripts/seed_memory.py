r"""Seed one user's past research "Backend Scaling" (R-12), for the memory search and the firefly demo.

Run from apps/api:
    .venv\Scripts\python app\engine\scripts\seed_memory.py <user-uuid>

Creates, for that user only, with ids derived from the user id: the dormant project (2026-03-12, 100 minutes of focus over
two days: 60 on the 11th, 40 on the 12th), its cluster with two explored branches (Redis, Postgres sessions), the user's
decision note, the stated decision "Redis not needed at expected scale", a saved context row, the research insight and its
two embeddings (kind 'insight' and 'context'). Idempotent. If the user already has a "Backend Scaling" project with an
insight (P's demo seed, apps/demo-seed) it does nothing. Writes P's tables (saved_contexts, browser_events) with plain
inserts: it is a dev tool, and the engine itself only reads them.
"""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID, uuid5

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from app.engine import db  # noqa: E402
from app.engine.embeddings import embed_texts  # noqa: E402

NS = UUID("5eed5eed-0000-4000-8000-0000000000a2")
NAME = "Backend Scaling"
GOAL = "Decide whether the backend needs Redis for sessions"
CONCLUSION = "Redis not needed at expected scale"
COMPARED = ["Redis", "Postgres sessions"]
INSIGHT = ("Researched session storage for the backend. Compared Redis with Postgres-backed sessions. "
           "Concluded that Redis not needed at expected scale; Postgres sessions are enough. "
           "Rejected Redis for now because it adds a service to run and secure.")
CONTEXT_TEXT = f"{NAME}: {GOAL}. {CONCLUSION}."
SESSIONS = (("2026-03-11T19:00:00+00:00", (30, 20, 10)), ("2026-03-12T19:00:00+00:00", (25, 15)))  # minutes per tab
SAVED_AT = datetime.fromisoformat("2026-03-12T21:40:00+00:00")
TABLE_ORDER = ("research_insights", "cluster_tabs", "decisions", "user_notes", "intent_branches", "intent_clusters",
               "projects", "memory_embeddings", "saved_contexts", "browser_events")


def ids(user: UUID) -> dict[str, UUID]:
    return {k: uuid5(NS, f"{user}/{k}") for k in ("project", "cluster", "b0", "b1", "note", "decision", "context", "insight")}


def tab_refs(user: UUID) -> list[UUID]:
    return [uuid5(NS, f"{user}/tab/{i}") for i in range(5)]


async def seed(pool: Any, user: UUID) -> str:
    """Returns 'seeded' or 'present'."""
    present = await pool.fetchval(
        "SELECT count(*) FROM projects p JOIN research_insights ri ON ri.project_id = p.id AND ri.user_id = p.user_id "
        "WHERE p.user_id = $1 AND p.name = $2", user, NAME)
    if present:
        return "present"
    i, refs = ids(user), tab_refs(user)
    first, last = datetime.fromisoformat(SESSIONS[0][0]), datetime.fromisoformat(SESSIONS[1][0]) + timedelta(minutes=40)
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("INSERT INTO projects (id, user_id, name, status, created_at, last_active_at) "
                           "VALUES ($1, $2, $3, 'dormant', $4, $5) ON CONFLICT DO NOTHING", i["project"], user, NAME, first, last)
        await conn.execute("INSERT INTO intent_clusters (id, user_id, project_id, label, goal, goal_provenance, "
                           "goal_confidence, created_at) VALUES ($1, $2, $3, $4, $5, 'stated', 1.0, $6) ON CONFLICT DO NOTHING",
                           i["cluster"], user, i["project"], NAME, GOAL, SAVED_AT)
        for n, (key, label) in enumerate((("b0", COMPARED[0]), ("b1", COMPARED[1]))):
            await conn.execute("INSERT INTO intent_branches (id, user_id, cluster_id, label, status, position, created_at) "
                               "VALUES ($1, $2, $3, $4, 'explored', $5, $6) ON CONFLICT DO NOTHING",
                               i[key], user, i["cluster"], label, n, SAVED_AT)
        for n, ref in enumerate(refs):
            await conn.execute("INSERT INTO cluster_tabs (user_id, cluster_id, branch_id, tab_ref, importance, position, "
                               "assigned_at) VALUES ($1, $2, $3, $4, 0.5, $5, $6) ON CONFLICT DO NOTHING",
                               user, i["cluster"], i["b0"] if n < 3 else i["b1"], ref, n, SAVED_AT)
        await conn.execute("INSERT INTO user_notes (id, user_id, project_id, cluster_id, kind, text, created_at) "
                           "VALUES ($1, $2, $3, $4, 'decision', $5, $6) ON CONFLICT DO NOTHING",
                           i["note"], user, i["project"], i["cluster"], CONCLUSION, SAVED_AT - timedelta(minutes=10))
        evidence = [{"ref_kind": "note", "ref": f"n_{i['note']}", "why": "user note, March 12"}]
        await conn.execute("INSERT INTO decisions (id, user_id, cluster_id, text, provenance, confidence, evidence, "
                           "user_note_id, confirmed_at, created_at) VALUES ($1, $2, $3, $4, 'stated', 1.0, $5::jsonb, $6, $7, $7) "
                           "ON CONFLICT DO NOTHING", i["decision"], user, i["cluster"], CONCLUSION, json.dumps(evidence),
                           i["note"], SAVED_AT)
        await conn.execute("INSERT INTO saved_contexts (id, user_id, project_id, title, kind, snapshot, saved_at) "
                           "VALUES ($1, $2, $3, $4, 'resume', '{\"tabs\": []}'::jsonb, $5) ON CONFLICT DO NOTHING",
                           i["context"], user, i["project"], NAME, SAVED_AT)
        conclusion = {"id": f"dec_{i['decision']}", "text": CONCLUSION, "provenance": "stated", "confidence": 1.0,
                      "display_text": CONCLUSION, "user_note_id": f"n_{i['note']}", "evidence": evidence}
        await conn.execute(
            "INSERT INTO research_insights (id, user_id, project_id, saved_context_id, summary, compared, conclusion, "
            "rejected, open_questions, period_start, period_end, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, "
            "$8::jsonb, '[]'::jsonb, $9, $10, $11) ON CONFLICT DO NOTHING", i["insight"], user, i["project"], i["context"],
            INSIGHT, COMPARED, json.dumps(conclusion),
            json.dumps([{"option": "Redis", "reason": "Adds a service to run and secure at this scale"}]),
            first, last, SAVED_AT)
        n_ref = 0
        for start_s, minutes in SESSIONS:
            t, session = datetime.fromisoformat(start_s), uuid5(NS, f"{user}/session/{start_s}")
            for mins in minutes:
                ref = refs[n_ref % len(refs)]
                n_ref += 1
                for kind, at, ms in (("FOCUS", t, 0), ("BLUR", t + timedelta(minutes=mins), mins * 60_000)):
                    await conn.execute(
                        "INSERT INTO browser_events (ts, user_id, event_id, session_id, tab_ref, event_type, active_ms) "
                        "VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING", at, user,
                        uuid5(NS, f"{user}/{ref}/{kind}/{at.isoformat()}"), session, ref, kind, ms)
                t += timedelta(minutes=mins, seconds=30)
    await embed_texts(user, "insight", [(str(i["insight"]), INSIGHT)], pool)
    await embed_texts(user, "context", [(str(i["context"]), CONTEXT_TEXT)], pool)
    return "seeded"


async def delete(pool: Any, user: UUID) -> int:
    """Remove everything seed() created for this user (the tables above) and return the rows left (0)."""
    for table in TABLE_ORDER:
        await pool.execute(f"DELETE FROM {table} WHERE user_id = $1", user)  # noqa: S608 - fixed table names
    return sum([await pool.fetchval(f"SELECT count(*) FROM {t} WHERE user_id = $1", user) for t in TABLE_ORDER])  # noqa: S608


async def main(user: UUID) -> None:
    pool = await db.get_pool()
    if pool is None:
        sys.exit("DATABASE_URL is not set")
    try:
        print(f"{user}: {await seed(pool, user)}")
    finally:
        await db.close_pool()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: seed_memory.py <user-uuid>")
    asyncio.run(main(UUID(sys.argv[1])))
