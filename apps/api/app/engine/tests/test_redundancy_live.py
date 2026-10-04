"""Audit fixes 4 and 5 live: real Azure OpenAI + Tiger Cloud, the 28 demo tabs, test user ...00f4 (rows deleted at the end).

Grows the demo three times and asks POST /api/tabs/prune-suggestions about all 28 tabs each time. Also re-runs the
threshold calibration on real embeddings and checks the constant in redundancy.py is still the best F1.
Run with -s to read every suggestion.
"""

import asyncio
import importlib.util
import uuid
from pathlib import Path

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app.engine import prune, routes
from app.engine.fixtures import load_demo_tabs
from app.engine.redundancy import SEMANTIC_VINE_THRESHOLD
from app.engine.schemas import PruneResponse
from app.engine.settings import get_settings
from app.engine.standalone import app

settings = get_settings()
pytestmark = pytest.mark.skipif(not (settings.aoai_configured and settings.db_configured),
                                reason="AZURE_OPENAI_API_KEY or DATABASE_URL not set")
USER = uuid.UUID("00000000-0000-4000-8000-0000000000f4")
H = {"X-Dev-User": str(USER)}
DEMO = load_demo_tabs()
BODY = {"open_tabs": DEMO["open_tabs"], "hollow_count": 3, "snapshot_at": DEMO["snapshot_at"]}
REFS = [t["tab_ref"] for t in DEMO["open_tabs"]]
TABLES = ("suggested_actions", "unresolved_questions", "decisions", "cluster_tabs", "intent_branches", "user_notes",
          "research_insights", "intent_clusters", "analysis_runs", "projects", "memory_embeddings")


def script(name: str):
    spec = importlib.util.spec_from_file_location(name, Path(prune.__file__).parent / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def tid(n: int) -> str:
    return f"00000000-0000-4000-8000-{n:012d}"


def num(ref: str) -> int:
    return int(ref[-12:])


async def _sql(fn):
    c = await asyncpg.connect(settings.database_url.get_secret_value(), timeout=30)
    try:
        return await fn(c)
    finally:
        await c.close()


async def _clean(c) -> int:
    for t in TABLES:
        await c.execute(f"DELETE FROM {t} WHERE user_id = $1", USER)
    return sum([await c.fetchval(f"SELECT count(*) FROM {t} WHERE user_id = $1", USER) for t in TABLES])


@pytest.fixture(scope="module")
def client():
    asyncio.run(_sql(_clean))
    routes.limiter.reset()
    mp = pytest.MonkeyPatch()
    mp.setattr(routes, "get_settings", lambda: settings.model_copy(update={"auth_mode": "dev"}))
    with TestClient(app) as c:
        yield c
    mp.undo()
    left = asyncio.run(_sql(_clean))
    print(f"\ncleanup: rows left for user ...00f4: {left}")
    assert left == 0


def branch_of(grove, n):
    for t in grove["trees"]:
        for b in t["branches"]:
            if any(l["tab_ref"] == tid(n) for l in b["leaves"]):
                return (t["project_id"], b["label"])
    return None


# Runs first on purpose: it opens and closes its own database pool; the TestClient of the next test owns one in its own loop.
def test_the_threshold_in_the_code_is_still_the_best_f1_on_real_embeddings() -> None:
    cal = script("calibrate_redundancy")
    data = cal.load()
    vectors = asyncio.run(cal.embed(data["tabs"]))
    same = [(c, label) for c, label, ok, _, _ in cal.cosines(data, vectors) if ok]
    best = cal.choose(same)
    p, r, f1, *_ = cal.scores(same, SEMANTIC_VINE_THRESHOLD)
    best_f1 = cal.scores(same, best)[2]
    print(f"\ncode threshold {SEMANTIC_VINE_THRESHOLD}: precision {p:.3f} recall {r:.3f} F1 {f1:.3f}; best on this run {best} (F1 {best_f1:.3f})")
    assert f1 >= best_f1 - 0.03   # embeddings are deterministic enough that the chosen bar is within 0.03 F1 of the best


def test_the_demo_flags_the_two_articles_keeps_the_docs_and_lists_the_stale_job_tabs(client) -> None:
    same_branch_runs = 0
    for run in (1, 2, 3):
        grove = client.post("/api/grove/grow", json=BODY, headers=H).json()
        assert not grove["degraded"]
        r = client.post("/api/tabs/prune-suggestions", json={"tab_refs": REFS}, headers=H)
        assert r.status_code == 200
        PruneResponse.model_validate(r.json())
        found = r.json()["suggestions"]
        semantic_vines = [(sorted(num(x) for x in v["tab_refs"]), num(v["keep_ref"]), v["reason"][:60]) for t in grove["trees"]
                          for v in t["vines"] if v["kind"] == "semantic"]
        print(f"\n--- run {run}: grow {grove['run_id'][:10]}; tab 9 in {branch_of(grove, 9)[1]!r}, tab 10 in {branch_of(grove, 10)[1]!r}, "
              f"tab 1 in {branch_of(grove, 1)[1]!r}")
        print(f"    grove semantic vines: {semantic_vines or 'none'}")
        for s in found:
            print(f"    {s['kind']:<18} tabs {[num(x) for x in s['tab_refs']]} keep {num(s['keep_ref']) if s['keep_ref'] else None} "
                  f"default_selected={s['default_selected']} | {s['reason'][:72]}")
        cited = {e["ref"] for t in grove["trees"] for c in [t["goal"], t["direction"], *t["stones"], *t["mushrooms"],
                                                           *t["next_actions"], *t["hypotheses"]] if c for e in c["evidence"]
                 if e["ref_kind"] == "tab"}
        job = {n: ("cited" if tid(n) in cited else "uncited") for n in range(16, 21)}
        stale = next((s for s in found if s["kind"] == "stale"), None)
        print(f"    Job Search tabs 16-20: {job}; stale suggestion: {[num(x) for x in stale['tab_refs']] if stale else None}")

        # the rule: tabs 1 and 4 are never grouped, whatever the cosine (docs vs code)
        assert not any(num(x) == 4 for s in found if s["kind"] in ("semantic_redundant", "exact_duplicate") for x in s["tab_refs"])
        assert not any(s["keep_ref"] == tid(4) for s in found if s["keep_ref"])
        assert [s["tab_refs"] for s in found if s["kind"] == "exact_duplicate"] == [[tid(1), tid(2)]]
        # stale = no focus for 3 days AND not cited as evidence (the rule used)
        expected_stale = sorted(tid(n) for n in range(16, 21) if tid(n) not in cited)
        assert (sorted(stale["tab_refs"]) if stale else []) == expected_stale
        assert all(not s["default_selected"] for s in found if s["kind"] in ("stale", "distraction"))
        b9, b10, b1 = branch_of(grove, 9), branch_of(grove, 10), branch_of(grove, 1)
        if b9 == b10:
            same_branch_runs += 1
            sem = [s for s in found if s["kind"] == "semantic_redundant"]
            assert len(sem) == 1 and {tid(9), tid(10)} <= set(sem[0]["tab_refs"])
            assert sem[0]["keep_ref"] == (tid(1) if b1 == b9 else sem[0]["keep_ref"])   # the official docs, when in that branch
    assert same_branch_runs >= 2, "the model put tabs 9 and 10 in different branches in 2 of 3 runs"
