# ruff: noqa: E501
"""P-10 (privacy settings, nightly retention) and P-11 (delete a forest, delete the account).

Tests without `requires_db` need no database. The others need DATABASE_URL and create their own random users, who
are removed again at the end (DELETE /api/me semantics, so they also exercise the deletion). Run them against a
scratch database, not a shared one: the deletion tests count rows per table for their own user only, and the
retention tests pass only_users, but they still write.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app import retention
from app.auth import entra_user_id
from app.db import deletion_repository as dstore
from app.db import privacy_repository as pstore
from app.deletion import parse_project_id
from app.privacy import PrivacyPatch
from app.routes import db_pool
from tests.helpers import (
    PERSONAL_TID,
    _with_conn,
    bearer,
    contract,
    database_url,
    entra_token,
    example,
    make_app,
    requires_db,
)

PRIVACY = contract("privacy.example.json")
ME = contract("me.example.json")


class NoPool:
    """Stands in for the pool in tests that must fail before any query."""


def client_for(*, with_db: bool = False) -> TestClient:
    app = make_app()
    if not with_db:
        app.dependency_overrides[db_pool] = lambda: NoPool()
    return TestClient(app)


def new_account() -> tuple[dict[str, str], uuid.UUID]:
    oid = str(uuid.uuid4())
    return bearer(entra_token(oid=oid)), entra_user_id(PERSONAL_TID, oid)


def assert_error(response, expected: dict) -> None:
    assert response.status_code == expected["status"]
    assert response.headers["content-type"] == expected["content_type"]
    assert response.json() == expected["body"]


# --- no database needed ------------------------------------------------------------------------------

@pytest.mark.parametrize("method,path", [("GET", "/api/privacy"), ("PATCH", "/api/privacy"), ("DELETE", "/api/me"),
                                         ("DELETE", "/api/projects/p_10000000-0000-4000-8000-000000000001")])
def test_every_new_endpoint_needs_a_token(method, path) -> None:
    with client_for() as client:
        response = client.request(method, path, json={} if method == "PATCH" else None)
    assert response.status_code == 401 and response.headers["www-authenticate"] == "Bearer"


def test_a_retention_value_outside_7_30_90_is_the_contract_422() -> None:
    headers, _ = new_account()
    with client_for() as client:
        response = client.patch("/api/privacy", json={"retention_days": 45}, headers=headers)
    assert_error(response, example(PRIVACY, "reject_retention_value")["response"])


def test_a_domain_in_both_lists_is_the_contract_422() -> None:
    headers, _ = new_account()
    with client_for() as client:
        body = example(PRIVACY, "reject_domain_in_both_lists")["request"]["body"]
        response = client.patch("/api/privacy", json=body, headers=headers)
    assert_error(response, example(PRIVACY, "reject_domain_in_both_lists")["response"])


@pytest.mark.parametrize("body", [
    {"user_id": "x"}, {"excluded_domains_add": ["https://mybank.com"]}, {"excluded_domains_add": ["mybank.com/login"]},
    {"excluded_domains_add": ["*.mybank.com"]}, {"excluded_domains_add": ["my bank.com"]},
    {"excluded_domains_add": ["mybank.com:8080"]}, {"excluded_domains_add": [""]}, {"excluded_domains_add": ["a_b.com"]},
    {"excluded_domains_add": ["a" * 64 + ".com"]}, {"excluded_domains_add": [f"d{n}.com" for n in range(101)]},
    {"excluded_domains_remove": "mybank.com"}, {"paused_until": "tomorrow"}, {"paused_until": "2026-10-04T12:00:00"},
    {"retention_days": "30"}, {"retention_days": 30.5}, {"cloud_ai_enabled": "maybe"}, {"retention_days": 0}])
def test_bad_patch_bodies_are_422_and_never_reach_the_database(body) -> None:
    headers, _ = new_account()
    with client_for() as client:
        response = client.patch("/api/privacy", json=body, headers=headers)
    assert response.status_code == 422 and response.headers["content-type"] == "application/problem+json"


def test_domains_are_trimmed_lowercased_and_deduplicated() -> None:
    patch = PrivacyPatch(excluded_domains_add=["  MyBank.COM ", "mybank.com", "login.Example.org"],
                         excluded_domains_remove=["Old.net"])
    assert patch.excluded_domains_add == ["mybank.com", "login.example.org"]
    assert patch.excluded_domains_remove == ["old.net"]
    assert PrivacyPatch(excluded_domains_add=["a" * 63 + ".com", "localhost", "a-b.c1"]).excluded_domains_add


def test_resume_and_leave_unchanged_are_different_things() -> None:
    assert "paused_until" in PrivacyPatch.model_validate({"paused_until": None}).model_fields_set
    assert PrivacyPatch.model_validate({"paused_until": None}).paused_until is None
    assert "paused_until" not in PrivacyPatch.model_validate({"retention_days": 7}).model_fields_set
    forever = PrivacyPatch.model_validate({"paused_until": "9999-12-31T23:59:59Z"}).paused_until
    assert forever is not None and forever.year == 9999


def test_unknown_or_malformed_project_ids_are_a_404_without_touching_the_database() -> None:
    headers, _ = new_account()
    with client_for() as client:
        for bad in ("nope", "p_not-a-uuid", "10000000-0000-4000-8000-000000000001", "p_", "P_" + str(uuid.uuid4())):
            response = client.delete(f"/api/projects/{bad}", headers=headers)
            assert response.status_code == 404 and response.json()["detail"] == "Project not found"
            assert response.json()["instance"] == f"/api/projects/{bad}"
    assert parse_project_id("p_" + str(uuid.UUID(int=5))) == uuid.UUID(int=5)
    assert parse_project_id("p_" + str(uuid.UUID(int=5)).upper()) == uuid.UUID(int=5)


def test_small_helpers() -> None:
    assert dstore.deleted_count("DELETE 12") == 12 and dstore.deleted_count("UPDATE 0") == 0
    assert dstore.total({"a": 2, "b": 3}) == 5
    assert dstore.ME_TABLES == tuple(example(ME, "delete_account")["response"]["body"]["deleted"])
    forest = example(PRIVACY, "delete_forest")["response"]["body"]["deleted"]
    assert set(forest) <= set(dstore.PROJECT_TABLES) and set(dstore.PROJECT_TABLES) - set(forest) == {"research_insights"}
    noon = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)
    assert retention.next_run(noon) == datetime(2026, 10, 5, 3, 0, tzinfo=UTC)
    early = datetime(2026, 10, 4, 1, 0, tzinfo=UTC)
    assert retention.next_run(early) == datetime(2026, 10, 4, 3, 0, tzinfo=UTC)
    assert retention.next_run(datetime(2026, 10, 4, 3, 0, tzinfo=UTC)) == datetime(2026, 10, 5, 3, 0, tzinfo=UTC)


class FakeConn:
    """Records statements; raises for the tables named in `missing`."""

    def __init__(self, missing=()):
        self.missing, self.sql = set(missing), []

    def transaction(self):
        conn = self

        class Tx:
            async def __aenter__(self):
                return conn

            async def __aexit__(self, *exc):
                return False
        return Tx()

    async def execute(self, sql, *args):
        self.sql.append(sql)
        if any(f"FROM {t} " in sql or sql.endswith(f"FROM {t}") for t in self.missing):
            raise asyncpg.UndefinedTableError("missing")
        return "DELETE 3"


def test_a_missing_r_table_counts_as_zero_but_a_missing_p_table_is_an_error() -> None:
    conn = FakeConn(missing=["decisions"])
    assert asyncio.run(dstore._run(conn, "decisions", "DELETE FROM decisions WHERE user_id = $1", 1)) == 0
    assert asyncio.run(dstore._run(conn, "tabs", "DELETE FROM tabs WHERE user_id = $1", 1)) == 3
    conn = FakeConn(missing=["tabs"])
    with pytest.raises(asyncpg.UndefinedTableError):
        asyncio.run(dstore._run(conn, "tabs", "DELETE FROM tabs WHERE user_id = $1", 1))


def test_a_failed_aggregate_refresh_never_undoes_the_deletion() -> None:
    class Failing(FakeConn):
        async def execute(self, sql, *args):
            raise asyncpg.PostgresError("no such procedure")

    now = datetime.now(UTC)
    assert asyncio.run(dstore.refresh_aggregates(Failing(), now, now)) is False
    assert asyncio.run(dstore.refresh_aggregates(FakeConn(), None, None)) is True
    ok = FakeConn()
    assert asyncio.run(dstore.refresh_aggregates(ok, now, now)) is True and len(ok.sql) == 3
    assert all(s.startswith("CALL refresh_continuous_aggregate(") for s in ok.sql)


def test_every_statement_filters_on_the_user() -> None:
    for _, sql in (*dstore._PROJECT_STEPS, *dstore._ME_STEPS):
        assert "user_id = $1" in sql or sql == "DELETE FROM users WHERE id = $1", sql
        assert "$1" in sql and not any(ch in sql for ch in "{}")  # no string-built SQL


# --- with a database ---------------------------------------------------------------------------------

def run(coro):
    return asyncio.run(coro)


async def q(sql: str, *args: Any):
    return await _with_conn(lambda c: c.fetch(sql, *args))


async def count(table: str, user_id: uuid.UUID) -> int:
    column = "id" if table == "users" else "user_id"
    return await _with_conn(lambda c: c.fetchval(f"SELECT count(*) FROM {table} WHERE {column} = $1", user_id))  # noqa: S608


async def wipe(user_id: uuid.UUID) -> None:
    async def go(conn):
        await dstore.delete_me(user_id, conn)
    await _with_conn(go)


@pytest.fixture
def account():
    headers, user_id = new_account()
    with client_for(with_db=True) as client:
        yield client, headers, user_id
    if database_url():
        run(wipe(user_id))


def body_without_time(body: dict) -> dict:
    return {k: v for k, v in body.items() if k != "updated_at"}


@requires_db
def test_privacy_follows_the_contract_examples_in_order(account) -> None:
    client, headers, _ = account
    for name in ("get_defaults", "patch_exclude_and_retention", "patch_pause_one_hour", "patch_pause_until_resumed",
                 "patch_resume", "patch_remove_exclusion"):
        ex = example(PRIVACY, name)
        request = ex["request"]
        response = client.request(request["method"], request["path"], json=request["body"], headers=headers)
        assert response.status_code == ex["response"]["status"], name
        assert body_without_time(response.json()) == body_without_time(ex["response"]["body"]), name
        assert response.json()["updated_at"].endswith("Z") and len(response.json()["updated_at"]) == 20


@requires_db
def test_patch_changes_only_what_it_sends_and_an_empty_patch_changes_nothing(account) -> None:
    client, headers, _ = account
    first = client.patch("/api/privacy", json={"excluded_domains_add": ["b.com", "a.com"], "retention_days": 30},
                         headers=headers).json()
    assert first["excluded_domains"] == ["a.com", "b.com"] and first["retention_days"] == 30
    again = client.patch("/api/privacy", json={}, headers=headers).json()
    assert again == first  # not even updated_at moves
    nothing = client.patch("/api/privacy", json={"excluded_domains_add": ["a.com"], "excluded_domains_remove": ["zzz.com"]},
                           headers=headers).json()
    assert nothing["excluded_domains"] == ["a.com", "b.com"] and nothing["retention_days"] == 30
    paused = client.patch("/api/privacy", json={"paused_until": "2030-01-01T00:00:00Z"}, headers=headers).json()
    assert paused["paused_until"] == "2030-01-01T00:00:00Z" and paused["excluded_domains"] == ["a.com", "b.com"]
    other = client.patch("/api/privacy", json={"cloud_ai_enabled": False}, headers=headers).json()
    assert other["cloud_ai_enabled"] is False and other["paused_until"] == "2030-01-01T00:00:00Z"
    resumed = client.patch("/api/privacy", json={"paused_until": None}, headers=headers).json()
    assert resumed["paused_until"] is None and resumed["cloud_ai_enabled"] is False


@requires_db
def test_privacy_works_before_the_first_me_call_and_me_agrees(account) -> None:
    client, headers, _ = account
    assert client.get("/api/privacy", headers=headers).json()["retention_days"] == 90  # provisions the row
    client.patch("/api/privacy", json={"excluded_domains_add": ["mybank.com"]}, headers=headers)
    me = client.get("/api/me", headers=headers).json()
    assert me["first_sign_in"] is False and me["privacy"]["excluded_domains"] == ["mybank.com"]


@requires_db
def test_the_exclusion_list_is_capped(account) -> None:
    client, headers, _ = account
    for chunk in range(5):
        domains = [f"site{chunk}x{n}.example.com" for n in range(100)]
        assert client.patch("/api/privacy", json={"excluded_domains_add": domains}, headers=headers).status_code == 200
    over = client.patch("/api/privacy", json={"excluded_domains_add": ["one-too-many.example.com"]}, headers=headers)
    assert over.status_code == 422 and "At most 500" in over.json()["detail"]
    assert len(client.get("/api/privacy", headers=headers).json()["excluded_domains"]) == 500


@requires_db
def test_users_cannot_see_or_change_each_others_settings() -> None:
    a_headers, a_id = new_account()
    b_headers, b_id = new_account()
    try:
        with client_for(with_db=True) as client:
            client.patch("/api/privacy", json={"excluded_domains_add": ["a-only.com"], "retention_days": 7}, headers=a_headers)
            b = client.get("/api/privacy", headers=b_headers).json()
            assert b["excluded_domains"] == [] and b["retention_days"] == 90
            client.patch("/api/privacy", json={"excluded_domains_add": ["b-only.com"]}, headers=b_headers)
            a = client.get("/api/privacy", headers=a_headers).json()
            assert a["excluded_domains"] == ["a-only.com"] and a["retention_days"] == 7
    finally:
        run(wipe(a_id)), run(wipe(b_id))


@requires_db
def test_two_devices_adding_domains_at_the_same_time_lose_nothing(account) -> None:
    client, headers, user_id = account
    client.get("/api/privacy", headers=headers)

    async def both():
        conns = [await asyncpg.connect(database_url(), timeout=30) for _ in range(2)]
        try:
            await asyncio.gather(*(pstore.patch_privacy(user_id, c, add=[f"d{i}.com"], remove=[], set_paused=False,
                                                        paused_until=None, retention_days=None, cloud_ai_enabled=None)
                                   for i, c in enumerate(conns)))
        finally:
            for c in conns:
                await c.close()
    run(both())
    assert client.get("/api/privacy", headers=headers).json()["excluded_domains"] == ["d0.com", "d1.com"]


# deletion --------------------------------------------------------------------------------------------

async def seed(user_id: uuid.UUID) -> dict[str, Any]:
    """Two projects with everything R stores for one of them, plus events, tabs, contexts and embeddings."""
    ids: dict[str, Any] = {}
    now = datetime.now(UTC)
    vec = "[" + ",".join(["0.1"] * 1536) + "]"

    async def go(c: asyncpg.Connection) -> None:
        async with c.transaction():
            await c.execute("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING", user_id)
            await c.execute("INSERT INTO privacy_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING", user_id)
            run_id = await c.fetchval("INSERT INTO analysis_runs (user_id, kind, clusters, response) VALUES ($1, 'grow', 2, "
                                      "$2::jsonb) RETURNING run_id", user_id, "{}")
            for name in ("a1", "a2"):
                ids[name] = await c.fetchval("INSERT INTO projects (user_id, name) VALUES ($1, $2) RETURNING id", user_id, name)
            await c.execute("UPDATE analysis_runs SET response = $2::jsonb WHERE run_id = $1", run_id, json.dumps(
                {"run_id": f"r_{run_id}", "trees": [{"project_id": f"p_{ids['a1']}", "name": "a1"},
                                                    {"project_id": f"p_{ids['a2']}", "name": "a2"}]}))
            for name in ("a1", "a2"):
                cluster = await c.fetchval("INSERT INTO intent_clusters (user_id, project_id, analysis_run_id, goal, "
                                           "goal_provenance, goal_confidence) VALUES ($1, $2, $3, 'g', 'inferred', 0.7) "
                                           "RETURNING id", user_id, ids[name], run_id)
                ids[f"cluster_{name}"] = cluster
                branches = [await c.fetchval("INSERT INTO intent_branches (user_id, cluster_id, label) VALUES ($1, $2, $3) "
                                             "RETURNING id", user_id, cluster, f"b{n}") for n in range(2)]
                for _ in range(3 if name == "a1" else 2):
                    await c.execute("INSERT INTO cluster_tabs (user_id, cluster_id, branch_id, tab_ref) VALUES ($1, $2, $3, $4)",
                                    user_id, cluster, branches[0], uuid.uuid4())
                await c.execute("INSERT INTO decisions (user_id, cluster_id, text, provenance, confidence) "
                                "VALUES ($1, $2, 'd', 'inferred', 0.7)", user_id, cluster)
                question = await c.fetchval("INSERT INTO unresolved_questions (user_id, cluster_id, question, provenance, "
                                            "confidence) VALUES ($1, $2, 'q', 'inferred', 0.7) RETURNING id", user_id, cluster)
                await c.execute("INSERT INTO suggested_actions (user_id, cluster_id, action, unblocks_question_id, provenance, "
                                "confidence) VALUES ($1, $2, 'a', $3, 'inferred', 0.7)", user_id, cluster, question)
                await c.execute("INSERT INTO user_notes (user_id, project_id, text) VALUES ($1, $2, 'note')", user_id, ids[name])
                insight = await c.fetchval("INSERT INTO research_insights (user_id, project_id, summary) VALUES ($1, $2, 's') "
                                           "RETURNING id", user_id, ids[name])
                context = await c.fetchval("INSERT INTO saved_contexts (user_id, project_id, title, snapshot) VALUES ($1, $2, "
                                           "'t', '{}'::jsonb) RETURNING id", user_id, ids[name])
                ids[f"insight_{name}"], ids[f"context_{name}"] = insight, context
                for kind, source in (("insight", str(insight)), ("context", str(context))):
                    await c.execute("INSERT INTO memory_embeddings (user_id, kind, source_id, content_hash, embedding) "
                                    "VALUES ($1, $2, $3, $4, $5::vector)", user_id, kind, source, uuid.uuid4().hex * 2, vec)
            # a note tied to a1's cluster only (no project), a tab-level embedding, a shared tab, events and a session
            await c.execute("INSERT INTO user_notes (user_id, cluster_id, text) VALUES ($1, $2, 'cluster note')",
                            user_id, ids["cluster_a1"])
            await c.execute("INSERT INTO memory_embeddings (user_id, kind, source_id, content_hash, embedding) "
                            "VALUES ($1, 'tab', $2, $3, $4::vector)", user_id, str(uuid.uuid4()), uuid.uuid4().hex * 2, vec)
            session = uuid.uuid4()
            await c.execute("INSERT INTO browser_sessions (id, user_id, started_at, ended_at, event_count) "
                            "VALUES ($1, $2, $3, $4, 3)", session, user_id, now - timedelta(hours=2), now - timedelta(hours=1))
            tab = uuid.uuid4()
            for n in range(3):
                await c.execute("INSERT INTO browser_events (ts, user_id, event_id, session_id, tab_ref, event_type, active_ms) "
                                "VALUES ($1, $2, $3, $4, $5, 'BLUR', 60000)", now - timedelta(hours=2) + timedelta(minutes=n),
                                user_id, uuid.uuid4(), session, tab)
            await c.execute("INSERT INTO tabs (user_id, tab_ref, domain, first_seen) VALUES ($1, $2, 'x.com', $3)",
                            user_id, tab, now)
            await c.execute("REFRESH MATERIALIZED VIEW tab_attention_15m") if await c.fetchval(
                "SELECT relkind = 'm' FROM pg_class WHERE relname = 'tab_attention_15m'") else None
    await _with_conn(go)
    return ids


async def snapshot_counts(user_id: uuid.UUID) -> dict[str, int]:
    return {t: await count(t, user_id) for t in dstore.ME_TABLES}


@requires_db
def test_deleting_a_forest_removes_what_it_owns_and_nothing_else(account) -> None:
    client, headers, user_id = account
    ids = run(seed(user_id))
    other_headers, other_id = new_account()
    other_ids = run(seed(other_id))
    try:
        before = run(snapshot_counts(user_id))
        other_before = run(snapshot_counts(other_id))
        response = client.delete(f"/api/projects/p_{ids['a1']}", headers=headers)
        assert response.status_code == 200
        body = response.json()
        assert body["project_id"] == f"p_{ids['a1']}"
        assert body["deleted"] == {"projects": 1, "intent_clusters": 1, "intent_branches": 2, "cluster_tabs": 3,
                                   "research_insights": 1, "decisions": 1, "unresolved_questions": 1,
                                   "suggested_actions": 1, "user_notes": 2, "saved_contexts": 1, "memory_embeddings": 2}
        assert body["total"] == 16 and body["total"] == sum(body["deleted"].values())
        after = run(snapshot_counts(user_id))
        assert after["projects"] == 1 and after["intent_clusters"] == 1 and after["intent_branches"] == 2
        assert after["cluster_tabs"] == 2 and after["user_notes"] == before["user_notes"] - 2
        assert after["memory_embeddings"] == before["memory_embeddings"] - 2  # the tab embedding stays
        for untouched in ("browser_events", "browser_sessions", "tabs", "users", "privacy_settings", "analysis_runs"):
            assert after[untouched] == before[untouched], untouched
        assert run(snapshot_counts(other_id)) == other_before  # another user's rows are exactly as they were
        trees = run(q("SELECT response->'trees' AS t FROM analysis_runs WHERE user_id = $1", user_id))[0]["t"]
        assert [t["name"] for t in json.loads(trees)] == ["a2"]  # the stored grove no longer holds the deleted tree
        assert client.delete(f"/api/projects/p_{ids['a1']}", headers=headers).status_code == 404  # already gone
        stolen = client.delete(f"/api/projects/p_{other_ids['a1']}", headers=headers)
        assert stolen.status_code == 404 and stolen.json()["detail"] == "Project not found"  # not 403
        assert run(snapshot_counts(other_id)) == other_before
    finally:
        run(wipe(other_id))


@requires_db
def test_deleting_the_account_removes_every_row_and_nobody_elses(account) -> None:
    client, headers, user_id = account
    run(seed(user_id))
    other_headers, other_id = new_account()
    run(seed(other_id))
    try:
        before = run(snapshot_counts(user_id))
        other_before = run(snapshot_counts(other_id))
        assert all(n > 0 for n in before.values()), before
        response = client.delete("/api/me", headers=headers)
        assert response.status_code == 200
        body = response.json()
        assert list(body["deleted"]) == list(example(ME, "delete_account")["response"]["body"]["deleted"])
        assert body["deleted"] == before and body["total"] == sum(before.values())
        assert all(n == 0 for n in run(snapshot_counts(user_id)).values())
        assert run(snapshot_counts(other_id)) == other_before
        attention = run(q("SELECT count(*) AS n FROM tab_attention_15m WHERE user_id = $1", user_id))[0]["n"]
        assert attention == 0  # the aggregates were refreshed, so the deleted attention is gone as well
        again = client.delete("/api/me", headers=headers)
        assert again.status_code == 200 and again.json()["total"] == 0  # deleting twice is harmless
        fresh = client.get("/api/me", headers=headers).json()
        assert fresh["first_sign_in"] is True  # the next sign-in provisions a new account
    finally:
        run(wipe(other_id))


@requires_db
def test_ingest_and_privacy_still_work_for_a_user_who_was_deleted_and_came_back(account) -> None:
    client, headers, user_id = account
    event = {"event_id": str(uuid.uuid4()), "ts": datetime.now(UTC).isoformat(), "type": "OPEN",
             "tab_ref": str(uuid.uuid4()), "domain": "example.com", "title": "Example"}
    assert client.post("/api/events", json={"events": [event]}, headers=headers).status_code == 202
    assert client.delete("/api/me", headers=headers).json()["deleted"]["browser_events"] == 1
    event["event_id"] = str(uuid.uuid4())
    assert client.post("/api/events", json={"events": [event]}, headers=headers).status_code == 202
    assert client.get("/api/privacy", headers=headers).status_code == 200


# retention -------------------------------------------------------------------------------------------

async def seed_events(user_id: uuid.UUID, retention_days: int, ages_days: list[int]) -> None:
    async def go(c: asyncpg.Connection) -> None:
        await c.execute("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING", user_id)
        await c.execute("INSERT INTO privacy_settings (user_id, retention_days) VALUES ($1, $2) "
                        "ON CONFLICT (user_id) DO UPDATE SET retention_days = $2", user_id, retention_days)
        for age in ages_days:
            ts = datetime.now(UTC) - timedelta(days=age)
            session = uuid.uuid4()
            await c.execute("INSERT INTO browser_sessions (id, user_id, started_at, ended_at, event_count) "
                            "VALUES ($1, $2, $3, $3, 1)", session, user_id, ts)
            await c.execute("INSERT INTO browser_events (ts, user_id, event_id, session_id, tab_ref, event_type) "
                            "VALUES ($1, $2, $3, $4, $5, 'OPEN')", ts, user_id, uuid.uuid4(), session, uuid.uuid4())
    await _with_conn(go)


async def ages(user_id: uuid.UUID, table: str, column: str) -> list[int]:
    rows = await q(f"SELECT round(extract(epoch FROM now() - {column}) / 86400)::int AS d FROM {table} "  # noqa: S608
                   "WHERE user_id = $1 ORDER BY 1", user_id)
    return [r["d"] for r in rows]


@requires_db
def test_retention_deletes_only_what_each_user_chose_to_forget() -> None:
    seven, thirty, ninety = (uuid.uuid4() for _ in range(3))
    old = [100, 40, 10, 1]
    try:
        for uid, days in ((seven, 7), (thirty, 30), (ninety, 90)):
            run(seed_events(uid, days, old))

        async def job():
            pool = await asyncpg.create_pool(database_url(), min_size=1, max_size=3, timeout=30)
            try:
                first = await retention.run_retention(pool, only_users=[seven, thirty, ninety])
                second = await retention.run_retention(pool, only_users=[seven, thirty, ninety])
                async with pool.acquire() as held:  # another process already running the job
                    await held.fetchval(retention._LOCK)
                    blocked = await retention.run_retention(pool, only_users=[seven])
                    await held.fetchval(retention._UNLOCK)
                return first, second, blocked
            finally:
                await pool.close()
        first, second, blocked = run(job())
        assert first == {"browser_events": 3 + 2, "browser_sessions": 3 + 2}
        assert second == {"browser_events": 0, "browser_sessions": 0} and blocked is None
        assert run(ages(seven, "browser_events", "ts")) == [1]
        assert run(ages(thirty, "browser_events", "ts")) == [1, 10]
        assert run(ages(ninety, "browser_events", "ts")) == [1, 10, 40, 100]  # 90 days is the global policy's job
        assert run(ages(seven, "browser_sessions", "ended_at")) == [1]
        assert run(ages(thirty, "browser_sessions", "ended_at")) == [1, 10]
    finally:
        for uid in (seven, thirty, ninety):
            run(wipe(uid))


@requires_db
def test_retention_never_touches_a_ninety_day_user_however_old_the_events() -> None:
    uid = uuid.uuid4()
    try:
        run(seed_events(uid, 90, [200]))

        async def job():
            pool = await asyncpg.create_pool(database_url(), min_size=1, max_size=2, timeout=30)
            try:
                return await retention.run_retention(pool, only_users=[uid])
            finally:
                await pool.close()
        assert run(job()) is not None
        assert run(ages(uid, "browser_events", "ts")) == [200]
    finally:
        run(wipe(uid))
