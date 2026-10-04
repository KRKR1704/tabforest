"""R-12 live: real Azure OpenAI + real Tiger Cloud, test user …00f5 (and a stranger for isolation).

Seeds the past project "Backend Scaling" (scripts/seed_memory.py), searches it through the standalone app
(AUTH_MODE=dev), grows the 28 demo tabs and checks the firefly lands on Backend Auth only, runs the memory pass on a
dormant project of the user and finds it by search, checks user isolation, and deletes every row of the user (asserts 0).
Run with -s to see the outputs.
"""

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app.engine import db, memory, routes
from app.engine.aoai import AzureOpenAIClient
from app.engine.embeddings import _to_pgvector, embed_queries
from app.engine.fixtures import load_demo_tabs
from app.engine.grove import GrowRun
from app.engine.infer import PRIOR_RESEARCH_THRESHOLD, retrieve_prior_research
from app.engine.schemas import GroveResponse, MemorySearchResponse
from app.engine.scripts import seed_memory
from app.engine.settings import get_settings

settings = get_settings()
pytestmark = pytest.mark.skipif(not (settings.aoai_configured and settings.db_configured),
                                reason="AZURE_OPENAI_API_KEY or DATABASE_URL not set")
USER = uuid.UUID("00000000-0000-4000-8000-0000000000f5")
STRANGER = uuid.UUID("00000000-0000-4000-8000-0000000000f6")
HEADERS = {"X-Dev-User": str(USER)}
DEMO = load_demo_tabs()
BODY = {"open_tabs": DEMO["open_tabs"], "hollow_count": 3, "snapshot_at": DEMO["snapshot_at"]}
SNAP = datetime.fromisoformat(DEMO["snapshot_at"].replace("Z", "+00:00"))
TABLES = ("suggested_actions", "unresolved_questions", "decisions", "cluster_tabs", "intent_branches", "user_notes",
          "research_insights", "intent_clusters", "analysis_runs", "projects", "memory_embeddings", "saved_contexts",
          "browser_events")


def tid(n: int) -> str:
    return f"00000000-0000-4000-8000-{n:012d}"


async def _sql(fn):
    conn = await asyncpg.connect(settings.database_url.get_secret_value(), timeout=30)
    try:
        return await fn(conn)
    finally:
        await conn.close()


async def _clean(conn) -> int:
    for user in (USER, STRANGER):
        for table in TABLES:
            await conn.execute(f"DELETE FROM {table} WHERE user_id = $1", user)
    return sum([await conn.fetchval(f"SELECT count(*) FROM {t} WHERE user_id = ANY($1::uuid[])", [USER, STRANGER])
                for t in TABLES])


@pytest.fixture(scope="module", autouse=True)
def clean_user():
    asyncio.run(_sql(_clean))
    routes.limiter.reset()

    async def seed():
        pool = await db.get_pool()
        try:
            assert await seed_memory.seed(pool, USER) == "seeded"
            assert await seed_memory.seed(pool, USER) == "present"      # idempotent
        finally:
            await db.close_pool()
    asyncio.run(seed())
    yield
    left = asyncio.run(_sql(_clean))
    print(f"\ncleanup: {left} rows left for the test users")
    assert left == 0


@pytest.fixture
def dev_routes(monkeypatch):
    monkeypatch.setattr(routes, "get_settings", lambda: settings.model_copy(update={"auth_mode": "dev"}))


def search(client: TestClient, q: str, headers: dict = HEADERS) -> dict:
    r = client.get("/api/memory/search", params={"q": q}, headers=headers)
    assert r.status_code == 200, r.text
    MemorySearchResponse.model_validate(r.json())
    print(f"\nGET /api/memory/search?q={q}\n{json.dumps(r.json(), indent=1)}")
    return r.json()


def best_similarity(q: str) -> float:
    async def go():
        client = AzureOpenAIClient()
        try:
            vec = (await embed_queries(USER, [q], None, client=client)).vectors[q]
        finally:
            await client.aclose()
        return await _sql(lambda conn: conn.fetchval(
            "SELECT max(1 - (embedding <=> $2::vector)) FROM memory_embeddings WHERE user_id = $1 AND kind IN "
            "('insight', 'context')", USER, _to_pgvector(vec)))
    return round(float(asyncio.run(go())), 3)


def test_search_hits_and_misses(dev_routes) -> None:
    from app.engine.standalone import app
    with TestClient(app) as c:
        for q in ("session storage", "redis vs postgres sessions"):
            body = search(c, q)
            assert body["found"] and len(body["matches"]) == 1
            m = body["matches"][0]
            assert (m["project"], m["date"], m["attention_min"], m["compared"]) == (
                "Backend Scaling", "2026-03-12", 100, ["Redis", "Postgres sessions"])
            assert m["conclusion"]["provenance"] == "stated" and m["conclusion"]["text"] == seed_memory.CONCLUSION
            assert m["conclusion"]["evidence"][0]["why"] == "user note, March 12"
            assert m["saved_context_id"] == f"s_{seed_memory.ids(USER)['context']}" and m["similarity"] >= PRIOR_RESEARCH_THRESHOLD
        for q in ("recipe", "jwt refresh token storage", "tokyo itinerary"):
            body = search(c, q)
            assert body == {"found": False, "query": q, "message": "No related research found", "matches": []}
            print(f"   best raw similarity to the user's research: {best_similarity(q)} (threshold {PRIOR_RESEARCH_THRESHOLD})")
        assert c.get("/api/memory/search", headers=HEADERS).status_code == 422          # q is required
        assert c.get("/api/memory/search", params={"q": "x"}).status_code == 401        # no user


def test_other_user_sees_nothing(dev_routes) -> None:
    from app.engine.standalone import app
    with TestClient(app) as c:
        body = search(c, "session storage", {"X-Dev-User": str(STRANGER)})
        assert body == {"found": False, "query": "session storage", "message": "No related research found", "matches": []}


def test_firefly_lands_on_backend_auth_only(dev_routes) -> None:
    from app.engine.standalone import app
    with TestClient(app) as c:
        r = c.post("/api/grove/grow", json=BODY, headers=HEADERS)
        assert r.status_code == 200, r.text
        grove = GroveResponse.model_validate(r.json()).model_dump(mode="json")

    def tree_with(n):
        return next(t for t in grove["trees"] if tid(n) in [l["tab_ref"] for b in t["branches"] for l in b["leaves"]])
    auth, dinner, girl = tree_with(1), tree_with(21), next(t for t in grove["trees"] if "GirlHacks" in json.dumps(t))
    flies = {f["project_id"]: f for f in grove["fireflies"]}
    print(f"\ngrow: {len(grove['trees'])} trees, {len(grove['fireflies'])} firefly(ies): "
          f"{[(f['past_project_name'], f['past_date'], f['display_text']) for f in grove['fireflies']]}")

    async def measure():
        pool, client = await db.get_pool(), AzureOpenAIClient()
        try:
            run = GrowRun(USER, DEMO["open_tabs"], 0, pool=pool, client=client, snapshot_at=SNAP)
            lines = run.stream()
            await anext(lines)
            await lines.aclose()
            return [(c.label, (await retrieve_prior_research(pool, USER, c.centroid, threshold=-1.0))[0].similarity)
                    for c in run.clusters]
        finally:
            await db.close_pool()
            await client.aclose()
    for label, s in sorted(asyncio.run(measure()), key=lambda x: -x[1]):
        print(f"  {s:.4f}  {label}{'  <- firefly' if s >= PRIOR_RESEARCH_THRESHOLD else ''}")
    assert set(flies) == {auth["project_id"]}, "the firefly must land on Backend Auth only"
    assert dinner["project_id"] not in flies and girl["project_id"] not in flies
    assert flies[auth["project_id"]]["past_project_name"] == "Backend Scaling"


def test_pass_writes_the_insight_of_a_dormant_project_once_and_search_finds_it(dev_routes) -> None:
    pid, cid, branch, note, decision, ctx = (uuid.uuid4() for _ in range(6))
    tabs = [uuid.uuid4() for _ in range(2)]
    start = datetime.now(timezone.utc) - timedelta(days=9)

    async def seed(conn):
        await conn.execute("INSERT INTO projects (id, user_id, name, status, created_at, last_active_at) "
                           "VALUES ($1, $2, 'Lisbon Trip', 'dormant', $3, $4)", pid, USER, start, start + timedelta(hours=2))
        await conn.execute("INSERT INTO intent_clusters (id, user_id, project_id, label, goal, goal_provenance, "
                           "goal_confidence) VALUES ($1, $2, $3, 'Lisbon Trip', 'Plan a Lisbon trip', 'stated', 1.0)",
                           cid, USER, pid)
        for n, label in enumerate(("Staying in Alfama", "Staying in Baixa")):
            await conn.execute("INSERT INTO intent_branches (id, user_id, cluster_id, label, status, position) "
                               "VALUES ($1, $2, $3, $4, 'explored', $5)", branch if n == 0 else uuid.uuid4(), USER, cid, label, n)
        for n, t in enumerate(tabs):
            await conn.execute("INSERT INTO cluster_tabs (user_id, cluster_id, tab_ref, position) VALUES ($1, $2, $3, $4)",
                               USER, cid, t, n)
            for kind, at, ms in (("FOCUS", start + timedelta(minutes=30 * n), 0),
                                 ("BLUR", start + timedelta(minutes=30 * n + 25), 25 * 60_000)):
                await conn.execute("INSERT INTO browser_events (ts, user_id, event_id, session_id, tab_ref, event_type, "
                                   "active_ms) VALUES ($1, $2, $3, $4, $5, $6, $7)", at, USER, uuid.uuid4(), uuid.uuid4(),
                                   t, kind, ms)
        await conn.execute("INSERT INTO user_notes (id, user_id, project_id, cluster_id, kind, text) "
                           "VALUES ($1, $2, $3, $4, 'decision', 'Alfama is the best base for two nights')", note, USER, pid, cid)
        await conn.execute("INSERT INTO decisions (id, user_id, cluster_id, text, provenance, confidence, user_note_id, "
                           "evidence) VALUES ($1, $2, $3, 'Alfama is the best base for two nights', 'stated', 1.0, $4, "
                           "$5::jsonb)", decision, USER, cid, note,
                           json.dumps([{"ref_kind": "note", "ref": f"n_{note}", "why": "user note"}]))
        await conn.execute("INSERT INTO saved_contexts (id, user_id, project_id, title, kind, snapshot, saved_at) "
                           "VALUES ($1, $2, $3, 'Lisbon Trip', 'resume', '{\"tabs\": []}'::jsonb, $4)", ctx, USER, pid,
                           start + timedelta(hours=2))
    asyncio.run(_sql(seed))

    async def passes():
        pool, client = await db.get_pool(), AzureOpenAIClient()
        try:
            first = await memory.run_memory_pass(pool, client=client, user_id=USER)
            second = await memory.run_memory_pass(pool, client=client, user_id=USER)
            row = await pool.fetchrow("SELECT summary, compared, saved_context_id FROM research_insights "
                                      "WHERE user_id = $1 AND project_id = $2", USER, pid)
            return first, second, row
        finally:
            await db.close_pool()
            await client.aclose()
    first, second, row = asyncio.run(passes())
    print(f"\npass 1: checked {first.checked}, written {len(first.written)}; pass 2: written {len(second.written)}\n"
          f"insight: {row['summary']}")
    assert len(first.written) == 1 and second.written == [] and row["saved_context_id"] == ctx
    assert row["compared"] == ["Staying in Alfama", "Staying in Baixa"]

    from app.engine.standalone import app
    with TestClient(app) as c:
        body = search(c, "where to stay in lisbon")
    (m,) = [m for m in body["matches"] if m["project"] == "Lisbon Trip"]
    assert m["attention_min"] == 50 and m["conclusion"]["text"] == "Alfama is the best base for two nights"
    assert m["saved_context_id"] == f"s_{ctx}"


def test_dev_run_route_is_dev_only(monkeypatch) -> None:
    from app.engine.standalone import app
    monkeypatch.setattr(routes, "get_settings", lambda: settings.model_copy(update={"auth_mode": "prod"}))
    with TestClient(app) as c:
        assert c.post("/api/_memory/run", headers=HEADERS).status_code in (401, 404)
