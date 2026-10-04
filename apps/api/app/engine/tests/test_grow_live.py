"""R-7/R-8 live: real Azure OpenAI + real Tiger Cloud, the 28 demo tabs, test user …00cc.

Runs POST /api/grove/grow through the standalone app AND P's app (TestClient, AUTH_MODE=dev,
X-Dev-User), checks schema validity, stream order, persistence and GET /api/grove, and the
prior-research similarity of a seeded "Backend Scaling, 2026-03-12" insight. Every row of the
test user in R's tables (and analysis_runs) is deleted at the end; the test asserts 0 left.
Run with -s to see the per-line stream timestamps and the similarities.
"""

import asyncio
import json
import time
import uuid
from datetime import date, datetime

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app.engine import db, routes
from app.engine.aoai import AzureOpenAIClient
from app.engine.embeddings import embed_texts
from app.engine.fixtures import load_demo_tabs
from app.engine.grove import GrowRun
from app.engine.infer import PRIOR_RESEARCH_THRESHOLD, retrieve_prior_research
from app.engine.persist import persist_run
from app.engine.schemas import GroveResponse, stream_line_adapter
from app.engine.settings import get_settings

settings = get_settings()
pytestmark = pytest.mark.skipif(not (settings.aoai_configured and settings.db_configured),
                                reason="AZURE_OPENAI_API_KEY or DATABASE_URL not set")
USER = uuid.UUID("00000000-0000-4000-8000-0000000000cc")
HEADERS = {"X-Dev-User": str(USER)}
DEMO = load_demo_tabs()
BODY = {"open_tabs": DEMO["open_tabs"], "hollow_count": 3, "snapshot_at": DEMO["snapshot_at"]}
SNAP = datetime.fromisoformat(DEMO["snapshot_at"].replace("Z", "+00:00"))
R_TABLES = ("suggested_actions", "unresolved_questions", "decisions", "cluster_tabs", "intent_branches",
            "user_notes", "research_insights", "intent_clusters", "analysis_runs", "projects", "memory_embeddings")
SCALING_SUMMARY = ("Backend Scaling: compared Redis and Postgres sessions for storing user sessions; "
                   "concluded Redis is not needed at the expected scale.")


def tid(n: int) -> str:
    return f"00000000-0000-4000-8000-{n:012d}"


async def _sql(fn):
    conn = await asyncpg.connect(settings.database_url.get_secret_value(), timeout=30)
    try:
        return await fn(conn)
    finally:
        await conn.close()


async def _clean(conn) -> int:
    for table in R_TABLES:
        await conn.execute(f"DELETE FROM {table} WHERE user_id = $1", USER)
    return sum([await conn.fetchval(f"SELECT count(*) FROM {t} WHERE user_id = $1", USER) for t in R_TABLES])


@pytest.fixture(scope="module", autouse=True)
def clean_user():
    asyncio.run(_sql(_clean))
    routes.limiter.reset()

    async def seed():  # the past research the firefly should find
        pool = await db.get_pool()
        client = AzureOpenAIClient()
        try:
            pid, iid = uuid.uuid4(), uuid.uuid4()
            await pool.execute("INSERT INTO projects (id, user_id, name, status, created_at, last_active_at) "
                               "VALUES ($1, $2, 'Backend Scaling', 'dormant', '2026-03-11', '2026-03-12')", pid, USER)
            await pool.execute("INSERT INTO research_insights (id, user_id, project_id, summary, compared, period_start, "
                               "period_end) VALUES ($1, $2, $3, $4, $5, '2026-03-11', '2026-03-12T18:00:00Z')",
                               iid, USER, pid, SCALING_SUMMARY, ["Redis", "Postgres sessions"])
            await embed_texts(USER, "insight", [(str(iid), SCALING_SUMMARY)], pool, client=client)
        finally:
            await db.close_pool()
            await client.aclose()
    asyncio.run(seed())
    yield
    assert asyncio.run(_sql(_clean)) == 0


@pytest.fixture
def dev_routes(monkeypatch):
    monkeypatch.setattr(routes, "get_settings", lambda: settings.model_copy(update={"auth_mode": "dev"}))


def leaves(tree):
    return [l["tab_ref"] for b in tree["branches"] for l in b["leaves"]]


def tree_with(response, n):
    return next(t for t in response["trees"] if tid(n) in leaves(t))


# --- standalone app ----------------------------------------------------------------------------------

def test_grow_standalone_plain_persists_and_get_returns_it(dev_routes) -> None:
    from app.engine.standalone import app
    with TestClient(app) as c:
        r = c.post("/api/grove/grow", json=BODY, headers=HEADERS)
        assert r.status_code == 200, r.text
        grove = GroveResponse.model_validate(r.json()).model_dump(mode="json")
        got = c.get("/api/grove", headers=HEADERS)
        assert got.status_code == 200 and got.json() == r.json()
        assert c.get("/api/grove", headers={"X-Dev-User": str(uuid.uuid4())}).status_code == 404
    run_id = uuid.UUID(grove["run_id"][2:])

    async def rows(conn):
        run = await conn.fetchrow("SELECT clusters, llm_calls, latency_ms, downgraded_claims, hollow_count, response "
                                  "FROM analysis_runs WHERE run_id = $1 AND user_id = $2", run_id, USER)
        n_clusters = await conn.fetchval("SELECT count(*) FROM intent_clusters WHERE analysis_run_id = $1 AND user_id = $2",
                                         run_id, USER)
        n_tabs = await conn.fetchval("SELECT count(*) FROM cluster_tabs ct JOIN intent_clusters ic ON ic.id = ct.cluster_id "
                                     "WHERE ic.analysis_run_id = $1 AND ct.user_id = $2", run_id, USER)
        return run, n_clusters, n_tabs
    run, n_clusters, n_tabs = asyncio.run(_sql(rows))
    assert json.loads(run["response"])["run_id"] == grove["run_id"]
    assert run["clusters"] == n_clusters == len(grove["trees"]) and run["hollow_count"] == 3
    assert n_tabs == sum(len(leaves(t)) for t in grove["trees"])
    assert 1 <= run["llm_calls"] <= 8 + len(grove["trees"])
    print(f"\nstandalone run {grove['run_id']}: {len(grove['trees'])} trees, llm_calls {run['llm_calls']}, "
          f"latency {run['latency_ms']} ms, downgraded {run['downgraded_claims']}")

    # Prior research: the seeded insight lights a firefly on Backend Auth, not on Dinner.
    auth, dinner = tree_with(grove, 1), tree_with(grove, 21)
    flies = {f["project_id"] for f in grove["fireflies"]}
    assert auth["project_id"] in flies and dinner["project_id"] not in flies
    fly = next(f for f in grove["fireflies"] if f["project_id"] == auth["project_id"])
    assert (fly["past_project_name"], fly["past_date"]) == ("Backend Scaling", "2026-03-12")
    assert fly["display_text"] == "You researched this on March 12."


def test_prior_research_similarity_report() -> None:
    async def measure():
        pool, client = await db.get_pool(), AzureOpenAIClient()
        try:
            run = GrowRun(USER, DEMO["open_tabs"], 0, pool=pool, client=client, snapshot_at=SNAP)
            lines = run.stream()
            await anext(lines)  # the clusters line: R-5 is done, centroids are known
            await lines.aclose()
            out = {}
            for c in run.clusters:
                hits = await retrieve_prior_research(pool, USER, c.centroid, threshold=-1.0)
                out[c.label] = (tid(1) in c.tab_refs, tid(21) in c.tab_refs, hits[0].similarity if hits else None)
            return out
        finally:
            await db.close_pool()
            await client.aclose()
    sims = asyncio.run(measure())
    print(f"\nraw similarity of 'Backend Scaling, 2026-03-12' to each cluster centroid "
          f"(threshold {PRIOR_RESEARCH_THRESHOLD}):")
    for label, (is_auth, is_dinner, s) in sims.items():
        print(f"  {s:.4f}  {label}{'  <- Backend Auth' if is_auth else ''}{'  <- Dinner' if is_dinner else ''}")
    auth = next(s for a, _, s in sims.values() if a)
    dinner = next(s for _, d, s in sims.values() if d)
    assert auth >= PRIOR_RESEARCH_THRESHOLD > dinner


# --- P's app ------------------------------------------------------------------------------------------

def test_grow_via_p_app_stream_and_get(dev_routes) -> None:
    from app.config import load_settings
    from app.main import create_app
    p_app = create_app(load_settings().model_copy(update={"auth_mode": "dev"}))
    assert p_app.state.engine_mounted
    with TestClient(p_app) as c:
        with c.stream("POST", "/api/grove/grow?stream=1", json=BODY, headers=HEADERS) as r:
            assert r.status_code == 200 and r.headers["content-type"].startswith("application/x-ndjson")
            lines = [json.loads(l) for l in r.iter_lines() if l.strip()]
        for line in lines:
            stream_line_adapter.validate_python(line)
        types = [l["type"] for l in lines]
        assert types[0] == "clusters" and types[-1] == "done" and set(types[1:-1]) == {"tree"}
        assert len(types) - 2 == len(lines[0]["clusters"])
        got = c.get("/api/grove", headers=HEADERS)
        assert got.status_code == 200 and got.json()["run_id"] == lines[-1]["run_id"]
        GroveResponse.model_validate(got.json())
        assert c.post("/api/grove/grow", json=BODY).status_code == 401  # no token, no dev header


def test_stream_clusters_line_arrives_before_any_tree_line() -> None:
    async def timed():
        pool, client = await db.get_pool(), AzureOpenAIClient()
        try:
            run = GrowRun(USER, DEMO["open_tabs"], 3, pool=pool, client=client, snapshot_at=SNAP, persist=persist_run)
            t0, out = time.perf_counter(), []
            async for line in run.stream():
                out.append((round(time.perf_counter() - t0, 3), line["type"], line.get("name", "")))
            return out
        finally:
            await db.close_pool()
            await client.aclose()
    stamps = asyncio.run(timed())
    print("\n" + "\n".join(f"  {t:7.3f}s  {kind:<8} {name}" for t, kind, name in stamps))
    assert stamps[0][1] == "clusters" and stamps[-1][1] == "done"
    assert stamps[0][0] < min(t for t, kind, _ in stamps if kind == "tree")
