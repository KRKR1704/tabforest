"""Contract tests for P-7, P-8 and P-9 (BUILD_TASKS.md P-1 rule: P's endpoints against P's examples).

The read endpoints need the contracts' story in the database: tests/story.py seeds one user with
R's intent rows and the story's events (sent through POST /api/events), and the API clock is
pinned to the story's 2026-10-04T11:40:00Z. Ids the server mints (sessions, saved contexts) are
mapped onto the contract's ids before comparing; everything else is compared exactly, except the
one known contract gap documented in tests/story.py.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app import clock
from tests import story
from tests.helpers import contract, db_run, example, make_app, purge_user, requires_db

SESSIONS = contract("sessions.example.json")
TIMELINE = contract("timeline.example.json")
CONTEXTS = contract("saved-context.example.json")


def story_client(user: UUID, at: datetime = story.STORY_NOW) -> tuple[TestClient, dict[str, str]]:
    app = make_app(auth_mode="dev")
    app.dependency_overrides[clock.now] = lambda: at
    return TestClient(app), {"X-Dev-User": str(user)}


@pytest.fixture(scope="module")
def story_user() -> Iterator[UUID]:
    user = uuid4()
    try:
        db_run(lambda conn: story.seed_intents(conn, user))
        client, headers = story_client(user)
        with client:
            sent = client.post("/api/events", json={"events": story.events()}, headers=headers)
        assert sent.status_code == 202, sent.text
        assert sent.json() == {"accepted": len(story.events()), "duplicates": 0}
        db_run(story.refresh_attention)
        yield user
    finally:
        purge_user(user)
        db_run(lambda conn: story.purge_intents(conn, user))
        db_run(story.refresh_attention)


def get(user: UUID, path: str, at: datetime = story.STORY_NOW):
    client, headers = story_client(user, at)
    with client:
        return client.get(path, headers=headers)


def post(user: UUID, path: str, body: dict | None = None, at: datetime = story.STORY_NOW):
    client, headers = story_client(user, at)
    with client:
        return client.post(path, json=body, headers=headers)


def at(stamp: str) -> datetime:
    return datetime.fromisoformat(stamp.replace("Z", "+00:00"))


# ---------- sessions.example.json ----------

GAP_SESSION = "ses_80000000-0000-4000-8000-000000000007"   # intent_switches: contract 3, story 0 (story.py)


def _contract_ids(body: dict, expected: dict) -> dict:
    """Server session ids → the contract's, by position (both newest first)."""
    mapped = dict(body)
    mapped["sessions"] = [dict(s, id=e["id"]) for s, e in zip(body["sessions"], expected["sessions"], strict=True)]
    return mapped


def _without_gap(body: dict) -> dict:
    rows = body["sessions"] if "sessions" in body else [body]
    for row in rows:
        if row["id"] == GAP_SESSION:
            row["intent_switches"] = "known gap"
    return body


@requires_db
def test_sessions_list_24h(story_user: UUID) -> None:
    ex = example(SESSIONS, "list_24h")
    response = get(story_user, ex["request"]["path"])
    assert response.status_code == 200
    got = _contract_ids(response.json(), ex["response"]["body"])
    assert next(s for s in got["sessions"] if s["id"] == GAP_SESSION)["intent_switches"] == 0
    assert _without_gap(got) == _without_gap(ex["response"]["body"])


@requires_db
def test_sessions_detail_morning(story_user: UUID) -> None:
    ex = example(SESSIONS, "detail_morning_session")
    listed = get(story_user, "/api/sessions?range=24h").json()["sessions"]
    morning = next(s["id"] for s in listed if s["started_at"] == ex["response"]["body"]["started_at"])
    response = get(story_user, f"/api/sessions/{morning}")
    assert response.status_code == 200
    got = dict(response.json(), id=ex["response"]["body"]["id"])
    assert _without_gap(got) == _without_gap(dict(ex["response"]["body"]))


@requires_db
def test_sessions_not_found(story_user: UUID) -> None:
    ex = example(SESSIONS, "not_found_other_users_session")
    response = get(story_user, ex["request"]["path"])
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json() == ex["response"]["body"]


def test_sessions_reject_unknown_range() -> None:
    ex = example(SESSIONS, "reject_unknown_range")
    client, headers = story_client(uuid4())
    with client:
        response = client.get(ex["request"]["path"], headers=headers)
    assert response.status_code == 422
    assert response.json() == ex["response"]["body"]


# ---------- timeline.example.json ----------


@requires_db
def test_timeline_story_24h(story_user: UUID) -> None:
    ex = example(TIMELINE, "story_24h")
    response = get(story_user, ex["request"]["path"])
    assert response.status_code == 200, response.text
    assert response.json() == ex["response"]["body"]


@requires_db
def test_timeline_not_found(story_user: UUID) -> None:
    ex = example(TIMELINE, "not_found_other_users_project")
    response = get(story_user, ex["request"]["path"])
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json() == ex["response"]["body"]


def test_timeline_reject_unknown_range() -> None:
    ex = example(TIMELINE, "reject_unknown_range")
    client, headers = story_client(uuid4())
    with client:
        response = client.get(ex["request"]["path"], headers=headers)
    assert response.status_code == 422
    assert response.json() == ex["response"]["body"]


# ---------- saved-context.example.json ----------


@requires_db
def test_saved_contexts_save_list_resume(story_user: UUID) -> None:
    """Save (resume, then references) → list → resume the next morning, as the examples run."""
    db_run(lambda conn: story.seed_old_context(conn, story_user))
    minted: dict[str, str] = {}
    for name in ("save_resume", "save_references"):
        ex = example(CONTEXTS, name)
        expected = ex["response"]["body"]
        response = post(story_user, ex["request"]["path"], ex["request"]["body"], at(expected["saved_at"]))
        assert response.status_code == 201, response.text
        minted[response.json()["id"]] = expected["id"]
        assert dict(response.json(), id=expected["id"]) == expected

    listed = example(CONTEXTS, "list_contexts")
    response = get(story_user, listed["request"]["path"])
    assert response.status_code == 200
    got = [dict(c, id=minted.get(c["id"], c["id"])) for c in response.json()["contexts"]]
    assert got == listed["response"]["body"]["contexts"]

    ex = example(CONTEXTS, "resume_next_morning")
    expected = ex["response"]["body"]
    server_id = next(k for k, v in minted.items() if v == expected["id"])
    response = post(story_user, ex["request"]["path"].replace(expected["id"], server_id), None,
                    at(expected["last_resumed_at"]))
    assert response.status_code == 200, response.text
    assert dict(response.json(), id=expected["id"]) == expected


@requires_db
@pytest.mark.parametrize("name", ["not_found_other_users_project", "not_found_other_users_context"])
def test_saved_contexts_not_found(story_user: UUID, name: str) -> None:
    ex = example(CONTEXTS, name)
    response = post(story_user, ex["request"]["path"], ex["request"].get("body"))
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/problem+json"
    assert response.json() == ex["response"]["body"]


def test_saved_contexts_reject_url_with_query_string() -> None:
    ex = example(CONTEXTS, "reject_url_with_query_string")
    response = post(uuid4(), ex["request"]["path"], ex["request"]["body"])
    assert response.status_code == 422
    assert response.json() == ex["response"]["body"]
