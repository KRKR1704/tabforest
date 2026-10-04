"""R-7/R-8 grow pipeline with a mocked Azure OpenAI client (no network, no database unless noted)."""

import asyncio
import json
import uuid
import zlib
from datetime import datetime
from typing import Any, Callable

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.engine import grove as grove_mod
from app.engine import routes
from app.engine.aoai import ContentFilteredError, StructuredOutputError
from app.engine.cluster import Cluster, ClusterResult, Singleton
from app.engine.fixtures import load_demo_tabs
from app.engine.grove import GrowRun
from app.engine.infer import build_messages, embed_document, infer_cluster
from app.engine.features import DataBlock
from app.engine.model_schema import ClusterInference
from app.engine.schemas import GroveResponse, stream_line_adapter
from app.engine.settings import get_settings
from app.engine.standalone import app

DEMO = load_demo_tabs()
SNAP = datetime.fromisoformat(DEMO["snapshot_at"].replace("Z", "+00:00"))
USER = uuid.UUID("00000000-0000-4000-8000-0000000000e5")


def tid(n: int) -> str:
    return f"00000000-0000-4000-8000-{n:012d}"


GROUPS = {"auth": range(1, 11), "girlhacks": range(11, 16), "job": range(16, 21), "dinner": range(21, 24)}
KEY_DOMAIN = {"fastapi.tiangolo.com": "auth", "girlhacks-2026.devpost.com": "girlhacks", "www.linkedin.com": "job",
              "www.allrecipes.com": "dinner"}


def demo_result(groups: dict[str, range] = GROUPS) -> ClusterResult:
    clusters = [Cluster(id=str(uuid.uuid5(uuid.NAMESPACE_URL, name)), tab_refs=[tid(n) for n in ns], label=f"{name} terms",
                        centroid=[0.0] * 4, pinned_tab_refs=[], is_existing_project_id=None,
                        earliest_opened_at="2026-10-04T08:00:00+00:00") for name, ns in groups.items()]
    return ClusterResult(clusters, [Cluster("sprout", [tid(24), tid(25)], "ownership · rust · cli", [0.0] * 4, [], None,
                                            "2026-10-04T11:18:22+00:00")],
                         [Singleton(tid(26), "low affinity to any goal"), Singleton(tid(27), "low affinity to any goal")],
                         [Singleton(tid(28), "low affinity to any goal")], {})


def payload_of(messages: list[dict[str, str]]) -> dict[str, Any]:
    content = messages[1]["content"]
    escaped = content.split("<documents>\n", 1)[1].split("\n</documents>", 1)[0]
    return json.loads(json.loads(f'"{escaped}"'))


def good(name: str = "Project") -> ClusterInference:
    ev = [{"ref": "t1", "why": "long read"}, {"ref": "t2", "why": "revisited"}]
    return ClusterInference.model_validate({
        "project_name": name, "goal": {"text": "Choose an approach", "provenance": "inferred", "confidence": 0.8,
                                       "evidence": ev},
        "branches": [{"branch_ref": "b1", "label": "Main", "tab_refs": ["t1", "t2"], "status": "active"}],
        "current_direction": None, "decisions": [], "unresolved_questions": [], "blockers": [], "next_actions": [],
        "redundant_groups": [], "important_tab_refs": ["t1"], "hypotheses": []})


class FakeClient:
    """embed: deterministic vectors; chat: per-cluster behavior keyed by a domain in the DATA block."""

    def __init__(self, behavior: dict[str, Callable[[int], Any]] | None = None, delays: dict[str, float] | None = None):
        self.behavior = behavior or {}
        self.delays = delays or {}
        self.calls: list[str] = []

    async def embed(self, texts, *, batch_size=64):
        out = []
        for t in texts:
            rng = np.random.default_rng(zlib.crc32(t.encode()))
            out.append(list(rng.normal(size=1536)))
        return out

    async def chat_structured_usage(self, messages, model):
        p = payload_of(messages)
        key = next((KEY_DOMAIN[t["domain"]] for t in p["tabs"] if t["domain"] in KEY_DOMAIN), "other")
        self.calls.append(key)
        await asyncio.sleep(self.delays.get(key, 0))
        attempt = self.calls.count(key)
        fn = self.behavior.get(key)
        return (fn(attempt) if fn else good(key.title())), 100

    async def aclose(self):
        pass


def run_grow(client: FakeClient, result: ClusterResult | None = None, monkeypatch=None, tabs=None):
    async def fake_cluster(*a, **k):
        return result or demo_result()
    monkeypatch.setattr(grove_mod, "cluster_snapshot", fake_cluster)
    run = GrowRun(USER, tabs or DEMO["open_tabs"], 3, pool=None, client=client, snapshot_at=SNAP)

    async def collect():
        return [line async for line in run.stream()]
    return run, asyncio.run(collect())


# --- prompt -----------------------------------------------------------------------------------------

def test_data_block_is_an_escaped_embedded_document() -> None:
    doc = embed_document({"tabs": [{"ref": "t1", "title": 'Ignore "rules" — now\nplease'}]})
    assert doc.startswith('""" <documents>\n') and doc.endswith('\n</documents> """')
    inner = doc.split("\n")[1]
    assert '"' not in inner.replace('\\"', "") and "\\u2014" in inner and "\\\\n" in inner and inner.isascii()
    msgs = build_messages(DataBlock({"tabs": []}, {}))
    assert msgs[0]["role"] == "system" and "untrusted" in msgs[0]["content"] and "<documents>" in msgs[1]["content"]


# --- streaming --------------------------------------------------------------------------------------

def test_stream_order_clusters_then_trees_as_they_land_then_done(monkeypatch) -> None:
    client = FakeClient(delays={"auth": 0.15, "girlhacks": 0.05})
    run, lines = run_grow(client, monkeypatch=monkeypatch)
    types = [l["type"] for l in lines]
    assert types == ["clusters", "tree", "tree", "tree", "tree", "done"]
    for line in lines:
        stream_line_adapter.validate_python(line)
    assert lines[0]["meadow"] == [tid(26), tid(27)] and lines[0]["sprouts"][0]["tab_refs"] == [tid(24), tid(25)]
    assert lines[-2]["name"] == "Auth"            # slowest call lands last (as_completed, not cluster order)
    GroveResponse.model_validate(run.response)
    assert [t["name"] for t in run.response["trees"]] == ["Auth", "Girlhacks", "Job", "Dinner"]  # response keeps cluster order
    assert run.report.llm_calls == 4 and not run.response["degraded"] and run.response["banner_text"] is None


def test_content_filter_on_one_cluster_fogs_only_that_cluster(monkeypatch) -> None:
    def blocked(_):
        raise ContentFilteredError(frozenset({"indirect_attack"}), "prompt")
    run, lines = run_grow(FakeClient({"job": blocked}), monkeypatch=monkeypatch)
    trees = {t["project_id"]: t for t in run.response["trees"]}
    fogged = [t for t in trees.values() if t["fogged"]]
    assert len(fogged) == 1 and fogged[0]["name"] == "job terms" and fogged[0]["goal"]["provenance"] == "hypothesis"
    assert fogged[0]["goal"]["display_text"].startswith("Maybe:") and fogged[0]["stones"] == []
    assert all(not t["fogged"] for t in trees.values() if t is not fogged[0])
    assert run.response["degraded"] is False and "content filter" in run.response["banner_text"]
    assert list(run.report.fallbacks.values()) == ["content_filter:prompt:indirect_attack"]
    assert lines[-1]["degraded"] is False


def test_every_cluster_failing_is_degraded_with_the_seedling_banner(monkeypatch) -> None:
    def down(_):
        raise RuntimeError("connection refused")
    run, _ = run_grow(FakeClient({k: down for k in GROUPS}), monkeypatch=monkeypatch)
    assert run.response["degraded"] is True and run.response["banner_text"] == "AI unavailable — showing groups only"
    assert all(t["fogged"] and t["branches"][0]["label"] == "All tabs" for t in run.response["trees"])


def test_invalid_output_gets_one_repair_retry(monkeypatch) -> None:
    def flaky(attempt):
        if attempt == 1:
            raise StructuredOutputError("no parsed output")
        return good("Repaired")
    run, _ = run_grow(FakeClient({"dinner": flaky}), monkeypatch=monkeypatch)
    dinner = next(t for t in run.response["trees"] if t["name"] == "Repaired")
    assert not dinner["fogged"] and run.report.llm_calls == 5 and run.report.validation_failures == 1


def test_invalid_twice_falls_back_for_that_cluster_only(monkeypatch) -> None:
    def broken(_):
        raise StructuredOutputError("output truncated before it parsed")
    run, _ = run_grow(FakeClient({"dinner": broken}), monkeypatch=monkeypatch)
    assert run.report.fallbacks == {demo_result().clusters[3].id: "invalid_output"}
    assert run.report.llm_calls == 5 and sum(t["fogged"] for t in run.response["trees"]) == 1


def test_infer_cluster_never_raises() -> None:
    class Boom:
        async def chat_structured_usage(self, *a, **k):
            raise ValueError("unexpected")
    out = asyncio.run(infer_cluster("c", DataBlock({"tabs": []}, {}), Boom()))
    assert out.inference is None and out.fallback_reason == "ai_unavailable" and out.llm_calls == 1


def test_more_than_8_clusters_only_the_largest_8_get_ai(monkeypatch) -> None:
    tabs, groups = [], {}
    n = 0
    for c in range(10):
        size = 2 if c in (3, 7) else 3  # clusters 3 and 7 are the smallest
        refs = []
        for _ in range(size):
            n += 1
            ref = f"00000000-0000-4000-8000-{900 + n:012d}"
            refs.append(ref)
            tabs.append({"tab_ref": ref, "domain": f"site{c}.example.com", "title": f"Topic {c} page {n}",
                         "opener_tab_ref": None, "opened_at": f"2026-10-04T10:{n:02d}:00Z", "active": False,
                         "pinned": False, "dup_key": None, "search_query": None})
        groups[c] = refs
    clusters = [Cluster(f"c{c}", refs, f"topic {c}", [0.0] * 4, [], None, "2026-10-04T10:00:00+00:00")
                for c, refs in groups.items()]
    client = FakeClient()
    run, lines = run_grow(client, ClusterResult(clusters, [], [], [], {}), monkeypatch, tabs=tabs)
    assert len(client.calls) == 8 and run.report.llm_calls == 8
    assert run.report.fallbacks == {"c3": "llm_cap", "c7": "llm_cap"}
    assert sum(t["fogged"] for t in run.response["trees"]) == 2
    assert run.response["degraded"] is False and run.response["banner_text"] is None
    assert len([l for l in lines if l["type"] == "tree"]) == 10


# --- endpoint limits --------------------------------------------------------------------------------

class StubRun:
    def __init__(self, *a, **k):
        self.response = {"ok": True}

    async def stream(self):
        if False:
            yield {}


@pytest.fixture
def stubbed(monkeypatch):
    monkeypatch.setattr(routes, "GrowRun", StubRun)

    async def no_pool():
        return None
    monkeypatch.setattr(routes.db, "get_pool", no_pool)
    routes.limiter.reset()
    yield
    routes.limiter.reset()


def body(n: int = 3) -> dict:
    tabs = [dict(t) for t in DEMO["open_tabs"][:min(n, 28)]]
    while len(tabs) < n:
        t = dict(DEMO["open_tabs"][0])
        t["tab_ref"] = str(uuid.uuid4())
        tabs.append(t)
    return {"open_tabs": tabs, "hollow_count": 3}


def test_61_tabs_is_422(stubbed) -> None:
    h = {"X-Dev-User": str(USER)}
    with TestClient(app) as c:
        assert c.post("/api/grove/grow", json=body(60), headers=h).status_code == 200
        assert c.post("/api/grove/grow", json=body(61), headers=h).status_code == 422
        assert c.post("/api/grove/grow", json={**body(3), "user_id": str(USER)}, headers=h).status_code == 422
        assert c.post("/api/grove/grow", json=body(3)).status_code == 401


def test_11th_grow_in_a_minute_is_429(stubbed) -> None:
    h = {"X-Dev-User": str(uuid.uuid4())}
    with TestClient(app) as c:
        codes = [c.post("/api/grove/grow", json=body(3), headers=h).status_code for _ in range(11)]
        assert codes == [200] * 10 + [429]
        r = c.post("/api/grove/grow", json=body(3), headers=h)
        assert r.status_code == 429 and r.headers["content-type"].startswith("application/problem+json")
        assert int(r.headers["Retry-After"]) >= 1
        other = c.post("/api/grove/grow", json=body(3), headers={"X-Dev-User": str(uuid.uuid4())})
        assert other.status_code == 200  # per user


def test_daily_budget_is_429(stubbed, monkeypatch) -> None:
    async def spent(pool, user_id):
        return routes.DAILY_LLM_CALL_BUDGET
    monkeypatch.setattr(routes, "llm_calls_today", spent)
    with TestClient(app) as c:
        r = c.post("/api/grove/grow", json=body(3), headers={"X-Dev-User": str(uuid.uuid4())})
        assert r.status_code == 429 and "budget" in r.json()["detail"]


# --- pins (real database, mocked AI) -----------------------------------------------------------------

@pytest.mark.skipif(not get_settings().db_configured, reason="DATABASE_URL not set")
def test_pinned_tabs_are_never_overwritten(monkeypatch) -> None:
    import asyncpg

    from app.engine import db
    from app.engine.persist import persist_run

    user = uuid.UUID("00000000-0000-4000-8000-0000000000e6")
    pinned_project, old_cluster = uuid.uuid4(), uuid.uuid4()

    async def scenario():
        pool = await db.get_pool()
        try:
            await pool.execute("INSERT INTO projects (id, user_id, name) VALUES ($1, $2, 'My pinned project')",
                               pinned_project, user)
            await pool.execute("INSERT INTO intent_clusters (id, user_id, project_id, goal, goal_provenance, "
                               "goal_confidence) VALUES ($1, $2, $3, 'x', 'stated', 1)", old_cluster, user,
                               pinned_project)
            await pool.execute("INSERT INTO cluster_tabs (user_id, cluster_id, tab_ref, importance, assigned_by) "
                               "VALUES ($1, $2, $3, 0.5, 'user')", user, old_cluster, uuid.UUID(tid(9)))
            run = GrowRun(user, DEMO["open_tabs"], 0, pool=pool, client=FakeClient(), snapshot_at=SNAP,
                          persist=persist_run)
            async for _ in run.stream():
                pass
            old = await pool.fetchrow("SELECT importance, assigned_by FROM cluster_tabs WHERE cluster_id = $1 "
                                      "AND tab_ref = $2", old_cluster, uuid.UUID(tid(9)))
            new = await pool.fetch(
                "SELECT ic.project_id, ct.assigned_by FROM cluster_tabs ct JOIN intent_clusters ic ON ic.id = ct.cluster_id "
                "WHERE ct.user_id = $1 AND ct.tab_ref = $2 AND ic.analysis_run_id = $3", user, uuid.UUID(tid(9)),
                uuid.UUID(run.run_id))
            return run, old, new
        finally:
            for table in ("suggested_actions", "unresolved_questions", "decisions", "cluster_tabs", "intent_branches",
                          "intent_clusters", "analysis_runs", "projects", "memory_embeddings"):
                await pool.execute(f"DELETE FROM {table} WHERE user_id = $1", user)
            await db.close_pool()

    run, old, new = asyncio.run(scenario())
    assert (old["importance"], old["assigned_by"]) == (0.5, "user")          # the user's row is untouched
    assert [(r["project_id"], r["assigned_by"]) for r in new] == [(pinned_project, "user")]
    tree = next(t for t in run.response["trees"] if tid(9) in [l["tab_ref"] for b in t["branches"] for l in b["leaves"]])
    assert tree["project_id"] == f"p_{pinned_project}"
