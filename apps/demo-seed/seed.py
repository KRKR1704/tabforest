"""Demo seed (P-15): one demo account with browsing history and a past project to remember.

Writes, for the account you name:
- the users and privacy_settings rows;
- three days of browsing history (Oct 2 to 4: the events behind contracts/sessions.example.json, sent
  through the same ingest code as POST /api/events, so sessions, tabs and aggregates are real);
- the past project "Backend Scaling" of March 12: two sessions (100 minutes), a cluster with six tabs,
  the stated note and decision "Redis not needed at expected scale", a research insight, and the saved
  context s_60000000-...-0003, with Azure OpenAI embeddings for the insight and the context.

Running it again changes nothing: every id is fixed and every insert skips what exists. The
aggregates are refreshed over both windows, because the 3-day refresh policy never reaches March
and the 90-day retention job later drops those raw rows; the demo reads the aggregate (X17).

Run from apps/api (PowerShell):
    uv run python ..\\demo-seed\\seed.py --email demo@tabforest.local
    uv run python ..\\demo-seed\\seed.py --tid <tenant> --oid <object id>
    uv run python ..\\demo-seed\\seed.py --user-id <uuid> --dry-run

DATABASE_URL and the Azure OpenAI settings come from the environment or apps/api/.env. Nothing
secret is printed.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

API = Path(__file__).resolve().parents[1] / "api"
sys.path.insert(0, str(API))

import asyncpg  # noqa: E402
from dotenv import dotenv_values  # noqa: E402

from app.adapters.events_in import tab_updates, to_row  # noqa: E402
from app.auth import entra_user_id, fallback_user_id  # noqa: E402
from app.db import repository as repo  # noqa: E402
from app.schemas import EventIn  # noqa: E402
from tests import story  # noqa: E402 - the contracts' events

PAST_PROJECT = story.SCALING                       # (p_…099, "Backend Scaling")
PAST_CONTEXT = story.OLD_CONTEXT                   # s_…003
NOTE_ID = "n_40000000-0000-4000-8000-000000000003"
DECISION_ID = "dec_30000000-0000-4000-8000-000000000901"
SEED_NS = uuid.UUID("5eed5eed-0000-4000-8000-000000000015")

MARCH_12 = datetime.fromisoformat("2026-03-12T00:00:00+00:00")
CONCLUSION = "Redis not needed at expected scale"
COMPARED = ["Redis", "Postgres sessions"]
GOAL = "Decide whether the backend needs Redis for sessions"
INSIGHT = ("Researched session storage for the backend. Compared Redis with Postgres-backed sessions. "
           "Concluded that " + CONCLUSION[0].lower() + CONCLUSION[1:] + "; Postgres sessions are enough. "
           "Rejected Redis for now because it adds a service to run and secure.")

MARCH_TABS = [  # (domain, title, session 0 or 1, focused ms)
    ("redis.io", "Redis as a session store - Redis Docs", 0, 1_200_000),
    ("www.postgresql.org", "Table partitioning - PostgreSQL Documentation", 0, 1_200_000),
    ("stackoverflow.com", "Postgres vs Redis for session storage - Stack Overflow", 0, 1_200_000),
    ("docs.djangoproject.com", "How to use sessions - Django documentation", 1, 800_000),
    ("fastapi.tiangolo.com", "Middleware - FastAPI", 1, 800_000),
    ("render.com", "Redis pricing - Render", 1, 800_000),
]
SESSION_START = [datetime.fromisoformat("2026-03-12T19:00:00+00:00"),
                 datetime.fromisoformat("2026-03-12T21:00:00+00:00")]


def det(kind: str, *parts: object) -> uuid.UUID:
    return uuid.uuid5(SEED_NS, ":".join([kind, *map(str, parts)]))


def bare(prefixed: str) -> uuid.UUID:
    return story.bare(prefixed)


def resolve_user(args: argparse.Namespace) -> uuid.UUID:
    if args.user_id:
        return uuid.UUID(args.user_id)
    if args.email:
        return fallback_user_id(args.email)
    return entra_user_id(args.tid, args.oid)


def _event(session: int, tab: int, at: datetime, typ: str, tab_ref: str, **fields: Any) -> dict[str, Any]:
    return {"event_id": str(det("event", session, tab, typ)), "ts": at.isoformat().replace("+00:00", "Z"),
            "type": typ, "tab_ref": tab_ref, **fields}


def march_events() -> list[dict[str, Any]]:
    """Two sessions, 100 minutes in all: OPEN, FOCUS and BLUR per tab, switching in order."""
    events: list[dict[str, Any]] = []
    ctx = bare(PAST_CONTEXT)                         # tab refs as story.seed_old_context makes them
    for session in (0, 1):
        t, previous = SESSION_START[session], None
        for i, (domain, title, which, ms) in enumerate(MARCH_TABS):
            if which != session:
                continue
            ref = str(uuid.uuid5(ctx, str(i)))
            events.append(_event(session, i, t, "OPEN", ref, domain=domain, title=title,
                                 opener_tab_ref=None, search_query=None))
            events.append(_event(session, i, t, "FOCUS", ref, previous_tab_ref=previous))
            t += timedelta(milliseconds=ms)
            events.append(_event(session, i, t, "BLUR", ref, active_ms=ms))
            previous = ref
            t += timedelta(seconds=30)
    return events


def shifted(events: list[dict[str, Any]], days: int) -> list[dict[str, Any]]:
    if not days:
        return events
    return [{**e, "ts": (datetime.fromisoformat(e["ts"].replace("Z", "+00:00")) + timedelta(days=days))
             .isoformat().replace("+00:00", "Z")} for e in events]


async def ingest(conn: asyncpg.Connection, user: uuid.UUID, events: list[dict[str, Any]]) -> int:
    """Through the API's own ingest path, in batches of 500."""
    accepted = 0
    for start in range(0, len(events), 500):
        rows = [to_row(EventIn.model_validate(e)) for e in events[start:start + 500]]
        accepted += await repo.ingest_events(user, conn, rows, tab_updates(rows))
    return accepted


async def seed_past_project(conn: asyncpg.Connection, user: uuid.UUID) -> None:
    pid, ctx = bare(PAST_PROJECT[0]), bare(PAST_CONTEXT)
    cluster, branch = det("cluster", user), det("branch", user)
    note, decision = bare(NOTE_ID), bare(DECISION_ID)
    saved_at = datetime.fromisoformat("2026-03-12T21:40:00+00:00")
    insight = det("insight", user)
    async with conn.transaction():
        await conn.execute(
            "INSERT INTO projects (id, user_id, name, status, created_at, last_active_at) "
            "VALUES ($1, $2, $3, 'dormant', $4, $5) ON CONFLICT DO NOTHING",
            pid, user, PAST_PROJECT[1], SESSION_START[0], SESSION_START[1] + timedelta(minutes=35))
        await conn.execute(
            "INSERT INTO intent_clusters (id, user_id, project_id, label, goal, goal_provenance, goal_confidence, "
            "created_at) VALUES ($1, $2, $3, $4, $5, 'stated', 1.0, $6) ON CONFLICT DO NOTHING",
            cluster, user, pid, PAST_PROJECT[1], GOAL, saved_at)
        await conn.execute(
            "INSERT INTO intent_branches (id, user_id, cluster_id, label, status, position, created_at) "
            "VALUES ($1, $2, $3, 'Session storage', 'explored', 0, $4) ON CONFLICT DO NOTHING",
            branch, user, cluster, saved_at)
        for i in range(len(MARCH_TABS)):
            await conn.execute(
                "INSERT INTO cluster_tabs (user_id, cluster_id, branch_id, tab_ref, importance, position, assigned_at) "
                "VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING",
                user, cluster, branch, uuid.uuid5(ctx, str(i)), [0.9, 0.7, 0.6, 0.3, 0.2, 0.1][i], i, saved_at)
        await conn.execute(
            "INSERT INTO user_notes (id, user_id, project_id, cluster_id, kind, text, created_at) "
            "VALUES ($1, $2, $3, $4, 'decision', $5, $6) ON CONFLICT DO NOTHING",
            note, user, pid, cluster, CONCLUSION, saved_at - timedelta(minutes=10))
        await conn.execute(
            "INSERT INTO decisions (id, user_id, cluster_id, text, provenance, confidence, evidence, user_note_id, "
            "confirmed_at, created_at) VALUES ($1, $2, $3, $4, 'stated', 1.0, $5::jsonb, $6, $7, $7) "
            "ON CONFLICT DO NOTHING",
            decision, user, cluster, CONCLUSION,
            json.dumps([{"ref_kind": "note", "ref": NOTE_ID, "why": "user note, March 12"}]), note, saved_at)
        await conn.execute(
            "INSERT INTO research_insights (id, user_id, project_id, saved_context_id, summary, compared, conclusion, "
            "rejected, open_questions, period_start, period_end, created_at) "
            "VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, '[]'::jsonb, $9, $10, $11) ON CONFLICT DO NOTHING",
            insight, user, pid, ctx, INSIGHT, COMPARED,
            json.dumps({"id": DECISION_ID, "text": CONCLUSION, "provenance": "stated", "confidence": 1.0,
                        "user_note_id": NOTE_ID}),
            json.dumps([{"option": "Redis", "reason": "Adds a service to run and secure at this scale"}]),
            SESSION_START[0], SESSION_START[1] + timedelta(minutes=35), saved_at)
        await story.seed_old_context(conn, user)        # the saved context s_…003, ON CONFLICT-safe below


async def embed(pool: asyncpg.Pool, user: uuid.UUID) -> dict[str, int]:
    from app.engine.embeddings import DbStore, embed_texts
    stats = {}
    for kind, source, text in (("insight", str(det("insight", user)), INSIGHT),
                               ("context", str(bare(PAST_CONTEXT)), f"{PAST_PROJECT[1]}: {GOAL}. {CONCLUSION}.")):
        result = await embed_texts(user, kind, [(source, text)], pool, store=DbStore(pool))
        stats[kind] = result.stats.inserted
    return stats


async def counts(conn: asyncpg.Connection, user: uuid.UUID) -> dict[str, int]:
    tables = ("users", "privacy_settings", "browser_events", "browser_sessions", "tabs", "saved_contexts", "projects",
              "intent_clusters", "cluster_tabs", "user_notes", "decisions", "research_insights", "memory_embeddings")
    out = {}
    for t in tables:
        col = "id" if t == "users" else "user_id"
        out[t] = await conn.fetchval(f"SELECT count(*) FROM {t} WHERE {col} = $1", user)  # noqa: S608 - fixed names
    return out


async def run(url: str, user: uuid.UUID, *, shift_days: int, do_embed: bool, dry: bool, tid: str | None = None,
              oid: str | None = None) -> dict[str, Any]:
    pool = await asyncpg.create_pool(url, min_size=1, max_size=2, command_timeout=60)
    try:
        async with pool.acquire() as conn:
            before = await counts(conn, user)
            if dry:
                return {"dry_run": True, "user_id": str(user), "before": before,
                        "would_send": len(story.events()) + len(march_events())}
            await repo.ensure_user(user, conn, entra_tid=tid, entra_oid=oid, display_name="Demo user")
            history = await ingest(conn, user, shifted(story.events(), shift_days))
            march = await ingest(conn, user, march_events())
            await seed_past_project(conn, user)
            await story.refresh_attention(conn)      # history window (Oct 2-5)
            await conn.execute("CALL refresh_continuous_aggregate('tab_attention_15m', '2026-03-12', '2026-03-13')")
            await conn.execute("CALL refresh_continuous_aggregate('user_attention_daily', '2026-03-12', '2026-03-13')")
            after_rows = await counts(conn, user)
        embedded = await embed(pool, user) if do_embed else {}
        async with pool.acquire() as conn:
            after = await counts(conn, user)
        return {"user_id": str(user), "events_new": history + march, "embeddings_new": embedded,
                "before": before, "after_rows": after_rows, "after": after}
    finally:
        await pool.close()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    who = p.add_mutually_exclusive_group(required=True)
    who.add_argument("--email", help="fallback-login account: user id = uuid5('tabforest:local:'+email)")
    who.add_argument("--user-id", help="the account's user id")
    who.add_argument("--tid", help="Microsoft tenant id (use with --oid)")
    p.add_argument("--oid")
    p.add_argument("--shift-days", type=int, default=0, help="move the history by whole days (same value every run)")
    p.add_argument("--no-embed", action="store_true", help="skip the Azure OpenAI embeddings")
    p.add_argument("--dry-run", action="store_true", help="read only: print the account's current row counts")
    args = p.parse_args()
    if args.tid and not args.oid:
        p.error("--tid needs --oid")
    import os
    url = os.environ.get("DATABASE_URL") or dotenv_values(API / ".env").get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set (environment or apps/api/.env)")
    for key, value in dotenv_values(API / ".env").items():     # the engine reads Azure settings from the environment
        if value is not None:
            os.environ.setdefault(key, value)
    result = asyncio.run(run(url, resolve_user(args), shift_days=args.shift_days, do_embed=not args.no_embed,
                             dry=args.dry_run, tid=args.tid, oid=args.oid))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
