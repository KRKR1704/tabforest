"""Failure drills (P-16): runs the four drills for real against a local API process and prints what happened.

    cd apps/api
    uv run python scripts/failure_drills.py            # all drills
    uv run python scripts/failure_drills.py db ingest  # some of them: db | ingest | azure | late

Each drill starts its own uvicorn process (AUTH_MODE=dev, on this machine only, port 8790), breaks one
thing, and reports the observed result. Drills 2 to 4 use the real Tiger database with a fresh user
id and remove that user's rows afterwards. Nothing secret is printed.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import threading
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import asyncpg
import httpx
from dotenv import dotenv_values

API = Path(__file__).resolve().parents[1]
PORT = 8790
BASE = f"http://127.0.0.1:{PORT}"
ENV = {k: v for k, v in dotenv_values(API / ".env").items() if v is not None}
UNREACHABLE = "postgresql://nobody:nothing@127.0.0.1:9/none"
ORIGIN = "chrome-extension://nldemblgfgcaolkpkajdbefjfnileeoi"


def start(**overrides: str) -> subprocess.Popen:
    env = {**os.environ, **ENV, "AUTH_MODE": "dev", "ALLOWED_EXTENSION_ORIGIN": ORIGIN,
           "ENTRA_CLIENT_ID": ENV.get("ENTRA_CLIENT_ID", "84bf8d79-85c2-463d-a8eb-c0a4d22bdb24"), **overrides}
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:create_app", "--factory", "--port", str(PORT),
                             "--log-level", "warning"], cwd=API, env=env, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL)
    for _ in range(80):
        try:
            if httpx.get(f"{BASE}/health", timeout=1).status_code == 200:
                return proc
        except httpx.HTTPError:
            time.sleep(0.25)
    proc.kill()
    raise RuntimeError("server did not start")


def stop(proc: subprocess.Popen) -> None:
    proc.kill()
    proc.wait()


def events(n: int, start_at: datetime, user_tag: str) -> list[dict]:
    """n events: alternating FOCUS and BLUR on two tabs, ten seconds apart (deterministic ids per tag)."""
    out = []
    tabs = [str(uuid.uuid5(uuid.NAMESPACE_URL, f"{user_tag}:tab:{i}")) for i in range(2)]
    for i in range(n):
        base = {"event_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{user_tag}:event:{start_at.isoformat()}:{i}")),
                "ts": (start_at + timedelta(seconds=10 * i)).strftime("%Y-%m-%dT%H:%M:%SZ"), "tab_ref": tabs[i % 2]}
        out.append({**base, "type": "FOCUS", "previous_tab_ref": tabs[(i + 1) % 2]} if i % 2 == 0
                   else {**base, "type": "BLUR", "active_ms": 10000})
    return out


def post(user: str, batch: list[dict], timeout: float = 20) -> httpx.Response:
    return httpx.post(f"{BASE}/api/events", json={"events": batch}, headers={"X-Dev-User": user}, timeout=timeout)


async def db_query(sql: str, *args):
    conn = await asyncpg.connect(ENV["DATABASE_URL"], timeout=30)
    try:
        return await conn.fetch(sql, *args)
    finally:
        await conn.close()


def totals(user: str) -> dict:
    u = uuid.UUID(user)
    row = asyncio.run(db_query(
        "SELECT count(*) AS events, count(DISTINCT event_id) AS distinct_ids, count(DISTINCT session_id) AS sessions, "
        "min(ts) AS first, max(ts) AS last FROM browser_events WHERE user_id = $1", u))[0]
    sessions = asyncio.run(db_query("SELECT count(*) AS n, coalesce(sum(event_count), 0) AS events "
                                    "FROM browser_sessions WHERE user_id = $1", u))[0]
    return {"events": row["events"], "distinct_event_ids": row["distinct_ids"], "sessions_in_events": row["sessions"],
            "browser_sessions_rows": sessions["n"], "session_event_count_sum": sessions["events"],
            "first": row["first"].isoformat() if row["first"] else None,
            "last": row["last"].isoformat() if row["last"] else None}


def cleanup(user: str) -> None:
    async def run() -> None:
        conn = await asyncpg.connect(ENV["DATABASE_URL"], timeout=30)
        try:
            async with conn.transaction():
                for table in ("browser_events", "browser_sessions", "tabs", "saved_contexts", "privacy_settings",
                              "user_notes", "suggested_actions", "decisions", "unresolved_questions", "cluster_tabs",
                              "intent_branches", "intent_clusters", "research_insights", "analysis_runs",
                              "projects", "memory_embeddings"):
                    await conn.execute(f"DELETE FROM {table} WHERE user_id = $1", uuid.UUID(user))  # noqa: S608
                await conn.execute("DELETE FROM users WHERE id = $1", uuid.UUID(user))
        finally:
            await conn.close()
    asyncio.run(run())


def show(title: str, data: dict) -> None:
    print(f"\n=== {title} ===")
    print(json.dumps(data, indent=2, default=str))


# ---- drill 1: Tiger Data down -----------------------------------------------------------------

def drill_db() -> None:
    proc = start(DATABASE_URL=UNREACHABLE)
    try:
        user = str(uuid.uuid4())
        t0 = time.time()
        r = post(user, events(2, datetime(2026, 10, 4, 12, tzinfo=UTC), user))
        health = httpx.get(f"{BASE}/health")
        me = httpx.get(f"{BASE}/api/me", headers={"X-Dev-User": user})
        sessions = httpx.get(f"{BASE}/api/sessions", headers={"X-Dev-User": user})
        show("1. Tiger Data down (DATABASE_URL points at a closed port)", {
            "POST /api/events": {"status": r.status_code, "retry_after": r.headers.get("retry-after"),
                                 "content_type": r.headers.get("content-type"), "body": r.json(),
                                 "seconds": round(time.time() - t0, 2)},
            "GET /health": {"status": health.status_code, "body": health.json()},
            "GET /api/me": {"status": me.status_code, "retry_after": me.headers.get("retry-after"), "body": me.json()},
            "GET /api/sessions": {"status": sessions.status_code, "retry_after": sessions.headers.get("retry-after")},
        })
    finally:
        stop(proc)


# ---- drill 2: restart during ingest -----------------------------------------------------------

def drill_ingest() -> None:
    user = str(uuid.uuid4())
    batches = [events(50, datetime(2026, 10, 4, 12, tzinfo=UTC) + timedelta(seconds=500 * k), f"{user}:{k}")
               for k in range(20)]
    sent_ids = {e["event_id"] for b in batches for e in b}
    proc = start()
    results: list[tuple[int, object]] = []
    acked = threading.Event()

    def sender() -> None:
        for k, batch in enumerate(batches):
            try:
                r = post(user, batch, timeout=15)
                results.append((k, r.status_code if r.status_code != 202 else r.json()))
            except httpx.HTTPError as exc:
                results.append((k, type(exc).__name__))
            if k == 7:
                acked.set()

    th = threading.Thread(target=sender)
    try:
        th.start()
        acked.wait(30)
        stop(proc)                                            # killed while batch 8 or 9 is in flight
        th.join(60)
        before_restart = totals(user)
        proc = start()
        failed = [k for k, r in results if not isinstance(r, dict)]
        retried = {k: post(user, batches[k]).json() for k in failed}          # the client retries what was not acked
        resent_all = {k: post(user, batches[k]).json() for k in range(len(batches))}
        after = totals(user)
        show("2. Restart (kill -9) during ingest", {
            "batches": len(batches), "events_per_batch": 50, "unique_events_sent": len(sent_ids),
            "acked_before_kill": [k for k, r in results if isinstance(r, dict)],
            "not_acked": {k: r for k, r in results if not isinstance(r, dict)},
            "stored_when_server_died": before_restart,
            "retry_of_unacked": retried,
            "then_full_resend_all_20_batches": {"accepted": sum(r["accepted"] for r in resent_all.values()),
                                                "duplicates": sum(r["duplicates"] for r in resent_all.values())},
            "final": after, "exactly_once": after["events"] == after["distinct_event_ids"] == len(sent_ids),
        })
    finally:
        stop(proc)
        cleanup(user)


# ---- drill 3: Azure OpenAI down ---------------------------------------------------------------

def drill_azure() -> None:
    sys.path.insert(0, str(API))
    from app.engine.fixtures import load_demo_tabs
    demo = load_demo_tabs()
    user = str(uuid.uuid4())
    proc = start(AZURE_OPENAI_API_KEY="wrong-key-for-the-drill")
    try:
        t0 = time.time()
        r = httpx.post(f"{BASE}/api/grove/grow", json={"open_tabs": demo["open_tabs"], "hollow_count": 3,
                                                        "snapshot_at": demo["snapshot_at"]},
                       headers={"X-Dev-User": user}, timeout=180)
        body = r.json()
        trees = body.get("trees", [])
        show("3. Azure OpenAI down (wrong API key), POST /api/grove/grow", {
            "status": r.status_code, "seconds": round(time.time() - t0, 1), "degraded": body.get("degraded"),
            "banner_text": body.get("banner_text"), "trees": len(trees),
            "fogged_trees": sum(1 for t in trees if t.get("fogged")),
            "claims_in_trees": sum(len(t.get(k, [])) for t in trees for k in ("stones", "mushrooms", "next_actions")),
            "tree_names": [t.get("name") for t in trees],
        })
        again = httpx.get(f"{BASE}/api/grove", headers={"X-Dev-User": user}, timeout=30)
        show("3b. GET /api/grove afterwards (cached last grove)", {"status": again.status_code,
                                                                   "degraded": again.json().get("degraded")})
    finally:
        stop(proc)
        cleanup(user)


# ---- drill 4: network drop, events flushed later ----------------------------------------------

def drill_late() -> None:
    user = str(uuid.uuid4())
    t0 = datetime(2026, 10, 2, 9, 0, tzinfo=UTC)
    first, queued, tail = events(20, t0, user + ":a"), events(20, t0 + timedelta(seconds=200), user + ":b"), \
        events(20, t0 + timedelta(seconds=400), user + ":c")
    proc = start()
    try:
        r1 = post(user, first).json()
        stop(proc)                                            # the network drops: the next batches cannot be sent
        outage_start = time.time()
        time.sleep(5)
        proc = start()
        flushed_after = round(time.time() - outage_start, 1)
        r2 = post(user, queued).json()                         # queued batch, original ts and ids
        r3 = post(user, tail).json()
        r2_again = post(user, queued).json()                   # an unacknowledged flush is retried
        stored = totals(user)
        sessions = httpx.get(f"{BASE}/api/sessions?range=7d", headers={"X-Dev-User": user}).json()["sessions"]
        show("4. Network drop: events flushed later keep their original timestamps", {
            "first_batch": r1, "flushed_seconds_after_the_drop": flushed_after,
            "queued_batch": r2, "tail_batch": r3, "queued_batch_retried": r2_again,
            "stored": stored,
            "expected_first_ts": first[0]["ts"], "expected_last_ts": tail[-1]["ts"],
            "api_sessions": [{"started_at": s["started_at"], "event_count": s["event_count"]} for s in sessions],
            "timestamps_kept": stored["first"].replace("+00:00", "Z") == first[0]["ts"]
            and stored["last"].replace("+00:00", "Z") == tail[-1]["ts"],
        })
    finally:
        stop(proc)
        cleanup(user)


DRILLS = {"db": drill_db, "ingest": drill_ingest, "azure": drill_azure, "late": drill_late}

if __name__ == "__main__":
    for name in sys.argv[1:] or list(DRILLS):
        DRILLS[name]()
