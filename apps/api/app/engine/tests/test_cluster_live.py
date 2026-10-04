"""R-5 live: real embeddings (R-4 cache) on the demo and the two calibration snapshots.

Runs only when Azure OpenAI and DATABASE_URL are configured. Test user …00ef; its
memory_embeddings rows are deleted after the module. Run with -s to see the reports.
"""

import asyncio
import json
import uuid

import asyncpg
import numpy as np
import pytest

from app.engine import db
from app.engine.aoai import AzureOpenAIClient
from app.engine.cluster import cluster, cluster_snapshot, load_pins, load_project_centroids, make_cluster_tabs
from app.engine.embeddings import embed_tabs
from app.engine.evaluation import SNAPSHOT_NAMES, ari, load_labeled_snapshot
from app.engine.normalize import normalize_tab
from app.engine.settings import get_settings

settings = get_settings()
pytestmark = pytest.mark.skipif(not (settings.aoai_configured and settings.db_configured),
                                reason="AZURE_OPENAI_API_KEY or DATABASE_URL not set")
USER = uuid.UUID("00000000-0000-4000-8000-0000000000ef")


def tid(n: int) -> str:
    return f"00000000-0000-4000-8000-{n:012d}"


@pytest.fixture(scope="module")
def data():
    snaps = {n: load_labeled_snapshot(n) for n in SNAPSHOT_NAMES}

    async def embed():
        client, pool = AzureOpenAIClient(), await db.get_pool()
        try:
            return {n: (await embed_tabs(USER, [normalize_tab(t) for t in s["open_tabs"]], pool, client=client)).vectors
                    for n, s in snaps.items()}
        finally:
            await db.close_pool()
            await client.aclose()

    vectors = asyncio.run(embed())
    yield snaps, vectors

    async def cleanup():
        conn = await asyncpg.connect(settings.database_url.get_secret_value(), timeout=30)
        try:
            await conn.execute("DELETE FROM memory_embeddings WHERE user_id = $1", USER)
            return await conn.fetchval("SELECT count(*) FROM memory_embeddings WHERE user_id = $1", USER)
        finally:
            await conn.close()

    assert asyncio.run(cleanup()) == 0


def run(snaps, vectors, name="demo", **kwargs):
    s = snaps[name]
    return cluster(make_cluster_tabs(s["open_tabs"]), vectors[name], s["snapshot_at"], **kwargs)


def cluster_of(result, ref):
    return next(c for c in result.clusters + result.sprouts if ref in c.tab_refs and
                c.id not in result.shared_tab_refs.get(ref, ()))


@pytest.mark.parametrize("name", SNAPSHOT_NAMES)
def test_ari_at_least_0_6(data, name) -> None:
    snaps, vectors = data
    score = ari(run(snaps, vectors, name), snaps[name]["labels"])
    print(f"\nARI {name}: {score:.3f}")
    assert score >= 0.6


def test_demo_sprout_search_tabs_and_singletons(data) -> None:
    snaps, vectors = data
    r = run(snaps, vectors)
    assert [sorted(s.tab_refs) for s in r.sprouts] == [[tid(24), tid(25)]]
    auth = cluster_of(r, tid(1))
    assert {tid(6), tid(7), tid(8)} <= set(auth.tab_refs)  # the three refresh-token searches
    singletons = {s.tab_ref for s in r.meadow + r.fog}
    assert {tid(26), tid(27), tid(28)} <= singletons
    print(f"\ndemo: {len(r.clusters)} trees {[c.label for c in r.clusters]}, sprout {[s.label for s in r.sprouts]}, "
          f"fog {[(s.tab_ref[-2:], s.reason) for s in r.fog]}, meadow {[s.tab_ref[-2:] for s in r.meadow]}")
    print(f"tab 05 shared naturally: {tid(5) in r.shared_tab_refs} (shared tabs: {list(r.shared_tab_refs) or 'none'})")


@pytest.mark.xfail(strict=True, reason="GirlHacks Prep splits: Tiger Data docs and d3-hierarchy share no title terms, "
                                       "opener edge or time with the Devpost tabs; only the model (R-7) can tie "
                                       "sponsor docs to the hackathon. Threshold 0.55 keeps 4 trees but drops 6 tabs "
                                       "into the meadow and lowers the minimum ARI to 0.815.")
def test_demo_has_exactly_4_trees(data) -> None:
    snaps, vectors = data
    assert len(run(snaps, vectors).clusters) == 4


def ground_truth_centroids(snaps, vectors) -> dict[str, np.ndarray]:
    labels = snaps["demo"]["labels"]
    out = {}
    for project, group in (("p_auth", "Backend Authentication"), ("p_job", "Job Search")):
        refs = [r for r, g in labels.items() if g == group]
        out[project] = np.mean([vectors["demo"][r] for r in refs], axis=0)
    return out


def test_pin_auth_tab_to_job_search_survives_rerun(data) -> None:
    snaps, vectors = data
    existing = ground_truth_centroids(snaps, vectors)
    results = [run(snaps, vectors, pins={tid(4): "p_job"}, existing_projects=existing) for _ in range(2)]
    for r in results:
        job = next(c for c in r.clusters if c.id == "p_job")
        assert tid(4) in job.tab_refs and job.pinned_tab_refs == [tid(4)]
        assert tid(4) not in cluster_of(r, tid(1)).tab_refs
    assert results[0].to_dict() == results[1].to_dict()


def test_pin_to_new_tree(data) -> None:
    snaps, vectors = data
    r = run(snaps, vectors, pins={tid(4): "p_new_tree"})
    new = next(c for c in r.clusters if c.id == "p_new_tree")
    assert new.tab_refs == [tid(4)] and new.pinned_tab_refs == [tid(4)]


def test_determinism(data) -> None:
    snaps, vectors = data
    for name in SNAPSHOT_NAMES:
        assert run(snaps, vectors, name).to_dict() == run(snaps, vectors, name).to_dict()


def test_db_loaders_and_cluster_snapshot(data) -> None:
    """Pins and project centroids from the DB, inside a rolled-back transaction; then the async entry point."""
    snaps, vectors = data
    tabs = snaps["demo"]["open_tabs"]

    async def check():
        conn = await asyncpg.connect(settings.database_url.get_secret_value(), timeout=30)
        try:
            tx = conn.transaction()
            await tx.start()
            try:
                project, cl = uuid.uuid4(), uuid.uuid4()
                await conn.execute("INSERT INTO projects (id, user_id, name) VALUES ($1, $2, 'Job Search')", project, USER)
                await conn.execute("INSERT INTO intent_clusters (id, user_id, project_id, goal, goal_provenance, "
                                   "goal_confidence) VALUES ($1, $2, $3, 'g', 'inferred', 0.7)", cl, USER, project)
                for n in (16, 17, 18):
                    await conn.execute("INSERT INTO cluster_tabs (user_id, cluster_id, tab_ref) VALUES ($1, $2, $3)",
                                       USER, cl, uuid.UUID(tid(n)))
                await conn.execute("INSERT INTO cluster_tabs (user_id, cluster_id, tab_ref, assigned_by) "
                                   "VALUES ($1, $2, $3, 'user')", USER, cl, uuid.UUID(tid(4)))
                pins = await load_pins(conn, USER, [t["tab_ref"] for t in tabs])
                centroids = await load_project_centroids(conn, USER)
            finally:
                await tx.rollback()
            left = await conn.fetchval("SELECT count(*) FROM cluster_tabs WHERE user_id = $1", USER)
        finally:
            await conn.close()
        return project, pins, centroids, left

    project, pins, centroids, left = asyncio.run(check())
    assert pins == {tid(4): str(project)} and left == 0
    expected = np.mean([vectors["demo"][tid(n)] for n in (4, 16, 17, 18)], axis=0)
    got = centroids[str(project)]
    assert float(np.dot(got, expected) / (np.linalg.norm(got) * np.linalg.norm(expected))) > 0.9999

    async def end_to_end():
        client, pool = AzureOpenAIClient(), await db.get_pool()
        try:
            return await cluster_snapshot(USER, tabs, pool, snaps["demo"]["snapshot_at"], client=client)
        finally:
            await db.close_pool()
            await client.aclose()

    assert json.dumps(asyncio.run(end_to_end()).to_dict(), default=str) == json.dumps(run(snaps, vectors).to_dict(),
                                                                                      default=str)
