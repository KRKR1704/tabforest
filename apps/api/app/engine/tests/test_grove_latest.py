"""Which stored grow is "the grove": one selection (persist.LAST_GROVE_SQL) for GET /api/grove and every mutation.

A 1-2 tab grow leaves a lone sprout and no trees; it must not hide the real grove. Real Tiger Cloud database, mocked
Azure OpenAI (test_claims.py's world). User …00e8; every row is deleted around each test.
"""

import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.engine import claims, db, routes
from app.engine.persist import last_grove, last_grove_row
from app.engine.schemas.claims import AssignRequest, ClaimPatchRequest
from app.engine.settings import get_settings
from app.engine.tests import test_claims as tc
from app.engine.tests.test_claims import USER, auth_tree, scenario, tid, world  # noqa: F401 - world is a fixture

pytestmark = pytest.mark.skipif(not get_settings().db_configured, reason="DATABASE_URL not set")
LATER = timedelta(minutes=5)


async def add_run(pool, *, trees: bool, degraded: bool = False, kind: str = "grow", later: timedelta = LATER) -> str:
    """A stored run newer than 'now' by `later`: with one tree (trees=True) or only a sprout (trees=False)."""
    run_id = uuid.uuid4()
    response = {"run_id": f"r_{run_id}", "degraded": degraded, "trees": [{"project_id": "p_x", "name": "X"}] if trees else [],
                "sprouts": [] if trees else [{"label": "lone"}], "meadow": [], "fog": []}
    snapshot = {"snapshot_at": "2026-10-04T11:40:00Z", "open_tabs": []}
    await pool.execute(
        "INSERT INTO analysis_runs (run_id, user_id, ts, kind, clusters, degraded, response, snapshot) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)", run_id, USER, datetime.now(timezone.utc) + later, kind,
        int(trees), degraded, json.dumps(response), json.dumps(snapshot))
    return response["run_id"]


def bare(test):
    """Like test_claims.scenario but with no first grow: the test builds the stored runs itself."""
    async def main():
        pool = await db.get_pool()
        try:
            for t in tc.TABLES:
                await pool.execute(f"DELETE FROM {t} WHERE user_id = $1", USER)
            return await test(pool)
        finally:
            for t in tc.TABLES:
                await pool.execute(f"DELETE FROM {t} WHERE user_id = $1", USER)
            left = sum([await pool.fetchval(f"SELECT count(*) FROM {t} WHERE user_id = $1", USER) for t in tc.TABLES])
            assert left == 0
            await db.close_pool()
    return asyncio.run(main())


# --- the selection ----------------------------------------------------------------------------------------------

def test_a_full_grow_then_a_two_tab_grow_still_serves_the_full_grove(world) -> None:
    async def test(w):
        full = (await w.stored())["run_id"]
        await add_run(w.pool, trees=False)                                   # the 2-tab grow: a sprout, no trees
        got = await w.stored()
        assert got["run_id"] == full and got["trees"]
        row = await last_grove_row(w.pool, USER)
        assert row["response"]["run_id"] == full
    scenario(world, test)


def test_get_grove_returns_the_full_grove_after_a_two_tab_grow(monkeypatch) -> None:
    from app.engine.standalone import app
    monkeypatch.setattr(routes, "get_settings", lambda: get_settings().model_copy(update={"auth_mode": "dev"}))
    ids = {}

    async def clean():
        pool = await db.get_pool()
        try:
            for t in tc.TABLES:
                await pool.execute(f"DELETE FROM {t} WHERE user_id = $1", USER)
            return sum([await pool.fetchval(f"SELECT count(*) FROM {t} WHERE user_id = $1", USER) for t in tc.TABLES])
        finally:
            await db.close_pool()

    async def seed():
        pool = await db.get_pool()
        try:
            ids["full"] = await add_run(pool, trees=True, later=timedelta(minutes=1))
            ids["sprout"] = await add_run(pool, trees=False, later=timedelta(minutes=3))
        finally:
            await db.close_pool()
    asyncio.run(clean())
    try:
        asyncio.run(seed())
        with TestClient(app) as c:
            got = c.get("/api/grove", headers={"X-Dev-User": str(USER)})
        assert got.status_code == 200 and got.json()["run_id"] == ids["full"] and got.json()["trees"]
    finally:
        assert asyncio.run(clean()) == 0


def test_only_sprout_runs_serve_the_newest_sprout_run() -> None:
    async def test(pool):
        await add_run(pool, trees=False, later=timedelta(minutes=1))
        newest = await add_run(pool, trees=False, later=timedelta(minutes=3))
        assert (await last_grove(pool, USER))["run_id"] == newest
    bare(test)


def test_a_degraded_grove_with_trees_beats_a_later_sprout_only_run() -> None:
    async def test(pool):
        degraded = await add_run(pool, trees=True, degraded=True, later=timedelta(minutes=1))
        await add_run(pool, trees=False, later=timedelta(minutes=3))
        got = await last_grove(pool, USER)
        assert got["run_id"] == degraded and got["degraded"] is True
    bare(test)


def test_a_full_grove_still_beats_a_newer_degraded_one() -> None:
    async def test(pool):
        full = await add_run(pool, trees=True, later=timedelta(minutes=1))
        await add_run(pool, trees=True, degraded=True, later=timedelta(minutes=3))
        assert (await last_grove(pool, USER))["run_id"] == full               # an outage never hides the last good grove
    bare(test)


def test_the_newest_grove_with_trees_wins_and_other_run_kinds_are_ignored() -> None:
    async def test(pool):
        await add_run(pool, trees=True, later=timedelta(minutes=1))
        newest = await add_run(pool, trees=True, later=timedelta(minutes=2))
        await add_run(pool, trees=True, kind="analyze_project", later=timedelta(minutes=9))
        await add_run(pool, trees=False, later=timedelta(minutes=10))
        assert (await last_grove(pool, USER))["run_id"] == newest
        assert await last_grove(pool, tc.OTHER) is None  # another user's runs are never served
    bare(test)


# --- a mutation edits the row GET returns -----------------------------------------------------------------------

def test_confirming_a_claim_after_a_sprout_run_edits_the_grove_get_returns(world) -> None:
    async def test(w):
        full = (await w.stored())["run_id"]
        sprout = await add_run(w.pool, trees=False)
        stone = next(s for s in auth_tree(await w.stored())["stones"] if s["kind"] == "mossy")
        out = await claims.patch_claim(w.pool, USER, stone["id"], ClaimPatchRequest.model_validate({"action": "confirm"}))
        assert out["provenance"] == "stated"
        got = await w.stored()
        assert got["run_id"] == full                                         # GET still serves the full grove ...
        assert next(s for s in auth_tree(got)["stones"] if s["id"] == stone["id"])["kind"] == "carved"   # ... edited
        sprout_row = await w.pool.fetchval("SELECT response FROM analysis_runs WHERE user_id = $1 AND run_id = $2", USER,
                                           uuid.UUID(sprout[2:]))
        assert json.loads(sprout_row)["trees"] == [] and "carved" not in sprout_row   # the sprout run was left alone
    scenario(world, test)


def test_assigning_a_tab_after_a_sprout_run_edits_the_grove_get_returns(world) -> None:
    async def test(w):
        full = await w.stored()
        await add_run(w.pool, trees=False)
        auth = auth_tree(full)
        out, status = await claims.assign_tab(w.pool, USER, tid(13), AssignRequest(project_id=auth["project_id"],
                                                                                   branch_label="Sessions"))
        assert status == 200
        now = await w.stored()
        assert now["run_id"] == full["run_id"]
        sessions = next(b for b in auth_tree(now)["branches"] if b["label"] == "Sessions")
        assert tid(13) in [leaf["tab_ref"] for leaf in sessions["leaves"]]
    scenario(world, test)
