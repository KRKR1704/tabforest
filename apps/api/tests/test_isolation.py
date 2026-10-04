"""P-12 isolation suite (BUILD_TASKS.md, SPEC 11.2): two users; B gets 404 on every resource of A,
on every endpoint that takes an id, and lists show B only B's own data. Events never cross users.

A is the contracts' demo story (tests/story.py: sessions, one project per tree, saved contexts);
B is a fresh user with nothing. Every attempt by B must also leave A's data exactly as it was.
Needs DATABASE_URL (skipped without it).
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest

from tests import story
from tests.helpers import contract, db_val, example, purge_user, requires_db
from tests.test_contracts_story import get, post, story_client, story_user  # noqa: F401 - module fixture

pytestmark = requires_db

AUTH = "p_10000000-0000-4000-8000-000000000001"
SAVE = example(contract("saved-context.example.json"), "save_resume")["request"]["body"]


def request(user: UUID, method: str, path: str, body: dict | None = None):
    client, headers = story_client(user)
    with client:
        return client.request(method, path, json=body, headers=headers)


def a_counts(user: UUID) -> dict[str, int]:
    return {t: db_val(f"SELECT count(*) FROM {t} WHERE user_id = $1", user)  # noqa: S608 - fixed names
            for t in ("browser_events", "browser_sessions", "tabs", "saved_contexts", "projects", "intent_clusters",
                      "cluster_tabs", "decisions", "unresolved_questions", "user_notes")}


@pytest.fixture(scope="module")
def a_user(story_user: UUID) -> UUID:  # noqa: F811
    context = post(story_user, f"/api/projects/{AUTH}/save-context", SAVE)
    assert context.status_code == 201
    return story_user


@pytest.fixture(scope="module")
def a_ids(a_user: UUID) -> dict[str, str]:
    return {"session": get(a_user, "/api/sessions").json()["sessions"][0]["id"],
            "context": get(a_user, "/api/contexts").json()["contexts"][0]["id"],
            "decision": "dec_30000000-0000-4000-8000-000000000301",
            "tab": story.tid(1)}


@pytest.fixture(scope="module")
def before(a_user: UUID) -> dict[str, int]:
    return a_counts(a_user)


def test_b_gets_404_on_every_resource_of_a(a_user: UUID, a_ids: dict[str, str], before: dict[str, int]) -> None:
    b = uuid4()
    attempts = [
        ("GET", f"/api/sessions/{a_ids['session']}", None, "Session not found"),
        ("GET", f"/api/projects/{AUTH}/timeline", None, "Project not found"),
        ("POST", f"/api/projects/{AUTH}/save-context", SAVE, "Project not found"),
        ("POST", f"/api/contexts/{a_ids['context']}/resume", None, "Saved context not found"),
        ("DELETE", f"/api/projects/{AUTH}", None, "Project not found"),
    ]
    for method, path, body, detail in attempts:
        response = request(b, method, path, body)
        assert response.status_code == 404, (method, path, response.text)
        assert response.headers["content-type"] == "application/problem+json"
        assert response.json()["detail"] == detail, (method, path)
    assert a_counts(a_user) == before          # nothing of A's changed, including the DELETE attempt


def test_b_cannot_reach_a_through_the_engine_routes(a_user: UUID, a_ids: dict[str, str],
                                                    before: dict[str, int]) -> None:
    b = uuid4()
    attempts = [
        ("PATCH", f"/api/claims/{a_ids['decision']}", {"action": "dismiss"}),
        ("POST", f"/api/tabs/{a_ids['tab']}/assign", {"project_id": AUTH}),
        ("POST", "/api/notes", {"kind": "note", "text": "not yours", "project_id": AUTH}),
    ]
    for method, path, body in attempts:
        response = request(b, method, path, body)
        assert response.status_code == 404, (method, path, response.status_code, response.text)
    assert a_counts(a_user) == before


def test_list_endpoints_show_b_only_its_own_data(a_user: UUID, a_ids: dict[str, str]) -> None:
    b = uuid4()
    assert get(b, "/api/sessions?range=7d").json()["sessions"] == []
    assert get(b, "/api/contexts").json() == {"contexts": []}
    assert get(a_user, "/api/sessions?range=7d").json()["sessions"]       # A's are still there
    me = get(b, "/api/me").json()
    assert me["user"]["id"] == str(b) and me["stats"]["total_forests"] == 0


def test_events_never_cross_users(a_user: UUID, before: dict[str, int]) -> None:
    """B sends the exact batch A sent (same event ids and times): B stores its own copy, A's rows
    are untouched, and neither user's sessions or tabs include the other's."""
    batch = story.EVENTS["batch_request"]
    b = uuid4()
    try:
        sent = post(b, "/api/events", batch)
        assert sent.json() == {"accepted": 45, "duplicates": 0}          # not a duplicate of A's events
        assert a_counts(a_user) == before
        assert db_val("SELECT count(*) FROM browser_events WHERE user_id = $1", b) == 45
        assert db_val("SELECT count(*) FROM browser_sessions WHERE user_id = $1", b) == 1
        a_sessions = {s["id"] for s in get(a_user, "/api/sessions?range=7d").json()["sessions"]}
        b_sessions = {s["id"] for s in get(b, "/api/sessions?range=7d").json()["sessions"]}
        assert len(b_sessions) == 1 and not a_sessions & b_sessions
        assert db_val("SELECT count(DISTINCT session_id) FROM browser_events WHERE user_id = $1 AND session_id IN "
                      "(SELECT id FROM browser_sessions WHERE user_id = $2)", b, a_user) == 0
    finally:
        purge_user(b)


def test_user_id_in_a_body_is_rejected(a_user: UUID) -> None:
    response = post(a_user, "/api/events", {"user_id": str(uuid4()), "events": story.EVENTS["batch_request"]["events"]})
    assert response.status_code == 422
    assert response.json()["detail"] == "Request body contains fields that are not allowed"
