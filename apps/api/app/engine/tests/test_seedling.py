"""R-9: Seedling fallback (proposal §8, §27) with a mocked Azure OpenAI client.

Total AI failure, partial failure, embedding failure, small snapshots, and GET /api/grove while Azure is down.
Test user …00ea (database tests) is cleaned around each test.
"""

import asyncio
import json
import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient

import test_grow as tg  # the tests directory is on sys.path (conftest.py)
from app.engine import db, routes
from app.engine import grove as grove_mod
from app.engine.aoai import ContentFilteredError, StructuredOutputError
from app.engine.fixtures import load_contract
from app.engine.grove import BANNER_ALL_FALLBACK, BANNER_LEARNING, GrowRun
from app.engine.infer import PriorInsight
from app.engine.persist import last_grove, persist_run
from app.engine.schemas import GroveResponse, stream_line_adapter
from app.engine.settings import get_settings
from app.engine.standalone import app

USER = uuid.UUID("00000000-0000-4000-8000-0000000000ea")
TABLES = ("suggested_actions", "unresolved_questions", "decisions", "cluster_tabs", "intent_branches", "user_notes",
          "research_insights", "intent_clusters", "analysis_runs", "projects", "memory_embeddings")
needs_db = pytest.mark.skipif(not get_settings().db_configured, reason="DATABASE_URL not set")


class AllDown(tg.FakeClient):
    """Azure chat is down (or the key is wrong): every call fails."""

    async def chat_structured_usage(self, messages, model):
        self.calls.append("down")
        raise RuntimeError("401 Unauthorized")


class EmbedDown(tg.FakeClient):
    async def embed(self, texts, *, batch_size=64):
        raise RuntimeError("401 Unauthorized")


def tabs_of(*numbers: int) -> list[dict]:
    return [t for t in tg.DEMO["open_tabs"] if int(t["tab_ref"][-12:]) in numbers]


# --- total failure -> Seedling ------------------------------------------------------------------------------------

def test_every_cluster_failing_is_seedling_and_matches_the_degraded_contract(monkeypatch) -> None:
    run, lines = tg.run_grow(AllDown(), monkeypatch=monkeypatch)
    resp = run.response
    GroveResponse.model_validate(resp)
    contract = load_contract("grove.degraded.example.json")
    assert set(resp) == set(contract) and resp["degraded"] is True
    assert resp["banner_text"] == contract["banner_text"] == BANNER_ALL_FALLBACK
    assert resp["fireflies"] == []
    assert len(resp["trees"]) == 4 and all(set(t) == set(contract["trees"][0]) for t in resp["trees"])
    for t in resp["trees"]:
        assert t["fogged"] and t["goal"]["provenance"] == "hypothesis" and t["goal"]["confidence"] <= 0.59
        assert t["goal"]["display_text"].startswith("Maybe: tabs about ") and t["name"].endswith("terms")  # labels.py terms
        assert t["stones"] == t["mushrooms"] == t["next_actions"] == t["hypotheses"] == [] and t["direction"] is None
        assert [b["label"] for b in t["branches"]] == ["All tabs"]
    assert [l["type"] for l in lines] == ["clusters", "tree", "tree", "tree", "tree", "done"]
    assert lines[-1]["degraded"] is True and lines[-1]["fireflies"] == []
    for line in lines:
        stream_line_adapter.validate_python(line)
    assert run.report.llm_calls == 4 and set(run.report.fallbacks.values()) == {"ai_unavailable"}


def test_seedling_shows_no_fireflies_but_a_normal_run_does(monkeypatch) -> None:
    prior = PriorInsight("11111111-2222-4333-8444-555555555555", "99999999-2222-4333-8444-555555555555",
                         "Backend Scaling", "Redis not needed", date(2026, 3, 12), 0.5, None)

    async def fake_prior(pool, user_id, centroid, **k):
        return [prior]
    monkeypatch.setattr(grove_mod, "retrieve_prior_research", fake_prior)
    down, _ = tg.run_grow(AllDown(), monkeypatch=monkeypatch)
    ok, _ = tg.run_grow(tg.FakeClient(), monkeypatch=monkeypatch)
    assert down.response["fireflies"] == [] and len(ok.response["fireflies"]) == 4


def test_some_clusters_failing_keeps_the_per_cluster_behaviour(monkeypatch) -> None:
    def blocked(_):
        raise ContentFilteredError(frozenset({"indirect_attack"}), "prompt")
    run, _ = tg.run_grow(tg.FakeClient({"job": blocked}), monkeypatch=monkeypatch)
    assert run.response["degraded"] is False and sum(t["fogged"] for t in run.response["trees"]) == 1
    assert "content filter" in run.response["banner_text"]


def test_invalid_json_twice_is_seedling_for_that_cluster_only(monkeypatch) -> None:
    def broken(_):
        raise StructuredOutputError("no parsed output")
    run, _ = tg.run_grow(tg.FakeClient({"dinner": broken}), monkeypatch=monkeypatch)
    assert run.response["degraded"] is False and [t["fogged"] for t in run.response["trees"]] == [False, False, False, True]
    assert list(run.report.fallbacks.values()) == ["invalid_output"] and run.report.llm_calls == 5  # one repair retry


# --- embeddings down -------------------------------------------------------------------------------------------------

def test_embedding_failure_clusters_by_term_overlap_and_is_seedling() -> None:
    client = EmbedDown()
    run = GrowRun(USER, tg.DEMO["open_tabs"], 3, pool=None, client=client, snapshot_at=tg.SNAP)
    lines = asyncio.run(_collect(run))
    resp = run.response
    GroveResponse.model_validate(resp)
    assert resp["degraded"] is True and resp["banner_text"] == BANNER_ALL_FALLBACK and resp["fireflies"] == []
    assert client.calls == [] and run.report.llm_calls == 0                       # no model call at all
    assert set(run.report.fallbacks.values()) == {"embeddings_unavailable"} and run.report.fallbacks
    assert resp["trees"] and all(t["fogged"] and t["goal"]["display_text"].startswith("Maybe: tabs about ")
                                 for t in resp["trees"])
    leaves = lambda t: [l["tab_ref"] for b in t["branches"] for l in b["leaves"]]  # noqa: E731
    auth = next(t for t in resp["trees"] if tg.tid(1) in leaves(t))
    assert tg.tid(4) in leaves(auth) and tg.tid(21) not in leaves(auth)          # shared title terms group the auth tabs
    assert [l["type"] for l in lines][0] == "clusters" and lines[-1]["degraded"] is True


async def _collect(run):
    return [line async for line in run.stream()]


# --- small snapshots -----------------------------------------------------------------------------------------------------

def hypothesis_goal(_):
    from app.engine.model_schema import ClusterInference
    inf = tg.good("x").model_dump()
    inf["goal"] = {"text": "Choose an approach", "provenance": "inferred", "confidence": 0.9,
                   "evidence": [{"ref": "t1", "why": "one ref only"}]}
    return ClusterInference.model_validate(inf)


def small(client, tabs, monkeypatch=None):
    run = GrowRun(USER, tabs, 0, pool=None, client=client, snapshot_at=tg.SNAP)
    return run, asyncio.run(_collect(run))


def test_three_tabs_are_one_sprout_named_by_one_validated_goal() -> None:
    client = tg.FakeClient()
    run, lines = small(client, tabs_of(1, 3, 4))
    resp = run.response
    GroveResponse.model_validate(resp)
    assert resp["trees"] == [] and resp["meadow"] == [] and resp["fog"] == [] and resp["degraded"] is False
    assert resp["banner_text"] == BANNER_LEARNING == "TabForest learns as you browse"
    [sprout] = resp["sprouts"]
    assert sprout["tab_refs"] == [tg.tid(1), tg.tid(3), tg.tid(4)]
    assert sprout["label"] == "Appears to be choosing an approach"                 # the validated goal, hedged
    assert len(client.calls) == 1 and run.report.llm_calls == 1
    assert [l["type"] for l in lines] == ["clusters", "done"] and lines[0]["clusters"] == []


def test_a_weak_goal_is_not_used_and_the_sprout_keeps_its_terms() -> None:
    client = tg.FakeClient({"auth": hypothesis_goal})
    run, _ = small(client, tabs_of(1, 3, 4))
    [sprout] = run.response["sprouts"]
    assert len(client.calls) == 1                                                  # still only one call
    assert "appears" not in sprout["label"].lower() and "·" in sprout["label"]          # top terms, not the weak goal


@pytest.mark.parametrize("failure", [StructuredOutputError("no parsed output"), RuntimeError("down"),
                                     ContentFilteredError(frozenset({"other"}), "prompt")])
def test_a_failed_goal_call_is_never_retried(failure) -> None:
    def fail(_):
        raise failure
    client = tg.FakeClient({"auth": fail})
    run, _ = small(client, tabs_of(1, 3))
    assert len(client.calls) == 1 and run.report.llm_calls == 1                    # at most ONE call, no repair retry
    assert "·" in run.response["sprouts"][0]["label"] and run.response["degraded"] is False


def test_two_tabs_are_a_sprout_too() -> None:
    run, _ = small(tg.FakeClient(), tabs_of(21, 22))
    assert [s["tab_refs"] for s in run.response["sprouts"]] == [[tg.tid(21), tg.tid(22)]]


def test_zero_and_one_tab_are_an_empty_grove_with_a_200() -> None:
    for n, tabs in ((0, []), (1, tabs_of(1))):
        client = tg.FakeClient()
        run, lines = small(client, tabs)
        r = run.response
        assert (r["trees"], r["sprouts"], r["meadow"], r["fog"], r["fireflies"]) == ([], [], [], [], []), n
        assert client.calls == [] and r["degraded"] is False and r["banner_text"] == BANNER_LEARNING
        assert [l["type"] for l in lines] == ["clusters", "done"]


def test_small_snapshots_over_http(monkeypatch) -> None:
    monkeypatch.setattr(routes, "AzureOpenAIClient", lambda: tg.FakeClient())

    async def no_pool():
        return None
    monkeypatch.setattr(routes.db, "get_pool", no_pool)
    routes.limiter.reset()
    h = {"X-Dev-User": str(uuid.uuid4())}
    with TestClient(app) as c:
        for tabs, expected in (([], 0), (tabs_of(1), 0), (tabs_of(1, 3, 4), 1)):
            r = c.post("/api/grove/grow", json={"open_tabs": tabs, "hollow_count": 2}, headers=h)
            assert r.status_code == 200 and len(r.json()["sprouts"]) == expected and r.json()["hollow_count"] == 2
            assert r.json()["banner_text"] == "TabForest learns as you browse"


# --- stream mode in Seedling ---------------------------------------------------------------------------------------------------

def test_seedling_stream_over_http(monkeypatch) -> None:
    monkeypatch.setattr(routes, "AzureOpenAIClient", lambda: AllDown())

    async def fake_cluster(*a, **k):
        return tg.demo_result()

    async def no_pool():
        return None
    monkeypatch.setattr(grove_mod, "cluster_snapshot", fake_cluster)
    monkeypatch.setattr(routes.db, "get_pool", no_pool)
    routes.limiter.reset()
    with TestClient(app) as c:
        with c.stream("POST", "/api/grove/grow?stream=1", json={"open_tabs": tg.DEMO["open_tabs"], "hollow_count": 3},
                      headers={"X-Dev-User": str(uuid.uuid4())}) as r:
            assert r.status_code == 200
            lines = [json.loads(l) for l in r.iter_lines() if l.strip()]
    assert [l["type"] for l in lines] == ["clusters", "tree", "tree", "tree", "tree", "done"]
    assert all(l["fogged"] for l in lines if l["type"] == "tree") and lines[-1]["degraded"] is True


# --- GET /api/grove while Azure is down ----------------------------------------------------------------------------------------

def db_scenario(monkeypatch, steps):
    async def fake_cluster(*a, **k):
        return tg.demo_result()
    monkeypatch.setattr(grove_mod, "cluster_snapshot", fake_cluster)

    async def main():
        pool = await db.get_pool()
        try:
            for t in TABLES:
                await pool.execute(f"DELETE FROM {t} WHERE user_id = $1", USER)
            return await steps(pool)
        finally:
            for t in TABLES:
                await pool.execute(f"DELETE FROM {t} WHERE user_id = $1", USER)
            assert sum([await pool.fetchval(f"SELECT count(*) FROM {t} WHERE user_id = $1", USER) for t in TABLES]) == 0
            await db.close_pool()
    return asyncio.run(main())


async def grow(pool, client, tabs=None):
    run = GrowRun(USER, tabs or tg.DEMO["open_tabs"], 3, pool=pool, client=client, snapshot_at=tg.SNAP, persist=persist_run)
    return run, [line async for line in run.stream()]


@needs_db
def test_get_grove_still_returns_the_last_full_grove_when_azure_is_down(monkeypatch) -> None:
    async def steps(pool):
        good, _ = await grow(pool, tg.FakeClient())
        down, _ = await grow(pool, AllDown())
        stored = await last_grove(pool, USER)
        row = await pool.fetchrow("SELECT degraded, fallback_used, llm_calls FROM analysis_runs WHERE user_id = $1 "
                                  "AND run_id = $2", USER, uuid.UUID(down.run_id))
        return good.response, down.response, stored, row
    good, down, stored, row = db_scenario(monkeypatch, steps)
    assert down["degraded"] is True and good["degraded"] is False
    assert stored["run_id"] == good["run_id"] and stored["degraded"] is False      # the earlier full grove
    assert (row["degraded"], row["fallback_used"]) == (True, True)                # the degraded run is still recorded


@needs_db
def test_get_grove_returns_a_degraded_grove_when_it_is_the_only_one(monkeypatch) -> None:
    async def steps(pool):
        down, _ = await grow(pool, AllDown())
        return down.response, await last_grove(pool, USER)
    down, stored = db_scenario(monkeypatch, steps)
    assert stored["run_id"] == down["run_id"] and stored["degraded"] is True


@needs_db
def test_embedding_failure_is_recorded_as_fallback_used(monkeypatch) -> None:
    async def steps(pool):
        monkeypatch.undo()  # real clustering: the embedding call fails, Jaccard clustering takes over
        run, _ = await grow(pool, EmbedDown())
        row = await pool.fetchrow("SELECT degraded, fallback_used, llm_calls, clusters FROM analysis_runs "
                                  "WHERE user_id = $1", USER)
        return run.response, row, await pool.fetchval("SELECT count(*) FROM memory_embeddings WHERE user_id = $1", USER)
    resp, row, embeddings = db_scenario(monkeypatch, steps)
    assert (row["degraded"], row["fallback_used"], row["llm_calls"]) == (True, True, 0) and row["clusters"] == len(resp["trees"])
    assert embeddings == 0                                                          # nothing half-cached
