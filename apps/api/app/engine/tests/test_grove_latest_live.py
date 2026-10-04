"""Live: a full grow, then a 2-tab grow, then GET /api/grove still serves the full grove (real Azure OpenAI + Tiger
Cloud, test user …00f9, standalone app with the dev header). Every row of the user is deleted at the end (asserts 0)."""

import asyncio
import uuid

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app.engine import routes
from app.engine.fixtures import load_demo_tabs
from app.engine.schemas import GroveResponse
from app.engine.settings import get_settings

settings = get_settings()
pytestmark = pytest.mark.skipif(not (settings.aoai_configured and settings.db_configured),
                                reason="AZURE_OPENAI_API_KEY or DATABASE_URL not set")
USER = uuid.UUID("00000000-0000-4000-8000-0000000000f9")
HEADERS = {"X-Dev-User": str(USER)}
DEMO = load_demo_tabs()
TABLES = ("suggested_actions", "unresolved_questions", "decisions", "cluster_tabs", "intent_branches", "user_notes",
          "research_insights", "intent_clusters", "analysis_runs", "projects", "memory_embeddings")


async def _clean() -> int:
    conn = await asyncpg.connect(settings.database_url.get_secret_value(), timeout=30)
    try:
        for t in TABLES:
            await conn.execute(f"DELETE FROM {t} WHERE user_id = $1", USER)
        return sum([await conn.fetchval(f"SELECT count(*) FROM {t} WHERE user_id = $1", USER) for t in TABLES])
    finally:
        await conn.close()


def test_a_two_tab_grow_does_not_hide_the_full_grove(monkeypatch) -> None:
    from app.engine.standalone import app
    monkeypatch.setattr(routes, "get_settings", lambda: settings.model_copy(update={"auth_mode": "dev"}))
    asyncio.run(_clean())
    routes.limiter.reset()
    try:
        with TestClient(app) as c:
            full = c.post("/api/grove/grow", json={"open_tabs": DEMO["open_tabs"], "hollow_count": 3,
                                                   "snapshot_at": DEMO["snapshot_at"]}, headers=HEADERS)
            assert full.status_code == 200, full.text
            full_grove = GroveResponse.model_validate(full.json()).model_dump(mode="json")
            two = c.post("/api/grove/grow", json={"open_tabs": DEMO["open_tabs"][:2], "hollow_count": 0,
                                                  "snapshot_at": DEMO["snapshot_at"]}, headers=HEADERS)
            assert two.status_code == 200, two.text
            two_grove = two.json()
            got = c.get("/api/grove", headers=HEADERS)
        print(f"\nfull grow: {len(full_grove['trees'])} trees, run {full_grove['run_id'][:10]}; "
              f"2-tab grow: {len(two_grove['trees'])} trees, {len(two_grove['sprouts'])} sprout(s), run {two_grove['run_id'][:10]}; "
              f"GET /api/grove: {len(got.json()['trees'])} trees, run {got.json()['run_id'][:10]}")
        assert two_grove["run_id"] != full_grove["run_id"] and not two_grove["trees"]
        assert got.status_code == 200 and got.json()["run_id"] == full_grove["run_id"] and got.json()["trees"]
    finally:
        assert asyncio.run(_clean()) == 0
