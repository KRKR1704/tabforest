"""Contract tests (BUILD_TASKS.md P-1): P's endpoints against the examples P drafted in contracts/.

Error examples are compared exactly (status, content type, body, headers). The tests marked
requires_db also need DATABASE_URL; without it (CI before P-14) they skip.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.auth import entra_user_id
from app.db.pool import StorageUnavailable
from app.schemas import EventBatch
from tests.helpers import (
    PERSONAL_TID,
    UNREACHABLE_DB,
    bearer,
    contract,
    entra_token,
    example,
    make_app,
    purge_user,
    requires_db,
)

EVENTS = contract("events.example.json")
ME = contract("me.example.json")
P_FILES = ["events.example.json", "timeline.example.json", "sessions.example.json",
           "saved-context.example.json", "privacy.example.json", "me.example.json"]


def assert_matches(response, expected: dict) -> None:
    assert response.status_code == expected["status"]
    assert response.headers["content-type"] == expected["content_type"]
    assert response.json() == expected["body"]
    for name, value in expected.get("headers", {}).items():
        assert response.headers[name] == value


@pytest.mark.parametrize("name", P_FILES)
def test_every_p_example_has_request_and_response(name: str) -> None:
    doc = contract(name)
    assert doc["examples"]
    for ex in doc["examples"]:
        assert {"name", "request", "response"} <= ex.keys()
        assert ex["request"]["method"] in {"GET", "POST", "PATCH", "DELETE"}
        assert ex["request"]["path"].startswith("/api/")
        assert isinstance(ex["response"]["status"], int)


def test_contract_batch_parses_with_p_models() -> None:
    batch = EventBatch.model_validate(example(EVENTS, "first_send")["request"]["body"])
    assert len(batch.events) == EVENTS["batch_response"]["accepted"] == 45
    assert {e.type.value for e in batch.events} == {"OPEN", "FOCUS", "BLUR", "UPDATE", "CLOSE", "IDLE", "ACTIVE"}
    assert EVENTS["batch_request"] == example(EVENTS, "first_send")["request"]["body"]


@pytest.mark.parametrize("name", ["reject_user_id_in_body", "reject_unknown_event_type"])
def test_events_422_examples(name: str) -> None:
    ex = example(EVENTS, name)
    with TestClient(make_app(auth_mode="dev")) as client:
        response = client.post("/api/events", json=ex["request"]["body"],
                               headers={"X-Dev-User": "452b6018-022d-5e0b-bd7c-101d3c412b79"})
    assert_matches(response, ex["response"])


def test_events_missing_token() -> None:
    ex = example(EVENTS, "missing_token")
    with TestClient(make_app()) as client:
        response = client.post("/api/events", json=ex["request"]["body"])
    assert_matches(response, ex["response"])


def test_events_database_unavailable() -> None:
    ex = example(EVENTS, "database_unavailable")
    with TestClient(make_app(auth_mode="dev", database_url=UNREACHABLE_DB)) as client:
        response = client.post("/api/events", json=ex["request"]["body"],
                               headers={"X-Dev-User": "452b6018-022d-5e0b-bd7c-101d3c412b79"})
    assert_matches(response, ex["response"])


class DownDatabase:
    """Fails at once, like a pool that can't open, without waiting for a refused connection."""

    async def pool(self):
        raise StorageUnavailable("test")

    async def close(self) -> None:
        pass


def test_events_rate_limited_on_the_61st_request() -> None:
    """60 requests per minute per user. The limit counts a request before any storage work, so with
    the database down requests 1-60 get 503 and request 61 gets 429."""
    ex = example(EVENTS, "rate_limited")
    headers = {"X-Dev-User": "0b9c4c34-3f0e-4c1b-9a43-2d5b1b6a7e11"}
    app = make_app(auth_mode="dev", database_url=UNREACHABLE_DB)
    with TestClient(app) as client:
        app.state.db = DownDatabase()
        statuses = [client.post("/api/events", json=ex["request"]["body"], headers=headers).status_code
                    for _ in range(60)]
        response = client.post("/api/events", json=ex["request"]["body"], headers=headers)
    assert set(statuses) == {503}
    assert response.status_code == 429
    assert response.json() == ex["response"]["body"]
    assert 1 <= int(response.headers["Retry-After"]) <= 60


@pytest.mark.parametrize("name", ["missing_token", "dev_header_rejected_in_prod"])
def test_me_401_examples(name: str) -> None:
    ex = example(ME, name)
    with TestClient(make_app()) as client:
        response = client.get("/api/me", headers=ex["request"].get("headers", {}))
    assert_matches(response, ex["response"])


def test_me_expired_token() -> None:
    ex = example(ME, "invalid_or_expired_token")
    with TestClient(make_app()) as client:
        response = client.get("/api/me", headers=bearer(entra_token(exp_in=-3600)))
    assert_matches(response, ex["response"])


@requires_db
def test_events_first_send_then_identical_resend(user_id) -> None:
    first, resend = example(EVENTS, "first_send"), example(EVENTS, "identical_resend")
    with TestClient(make_app(auth_mode="dev")) as client:
        r1 = client.post("/api/events", json=first["request"]["body"], headers={"X-Dev-User": str(user_id)})
        r2 = client.post("/api/events", json=resend["request"]["body"], headers={"X-Dev-User": str(user_id)})
    assert_matches(r1, first["response"])
    assert_matches(r2, resend["response"])


@requires_db
def test_me_first_call_provisions_then_later_call() -> None:
    expected = example(ME, "first_call_provisions")["response"]
    oid = str(uuid4())
    user = entra_user_id(PERSONAL_TID, oid)
    token = entra_token(oid=oid)  # aud = the API's client ID (X13)
    try:
        with TestClient(make_app()) as client:
            first = client.get("/api/me", headers=bearer(token))
            later = client.get("/api/me", headers=bearer(token))
        body = first.json()
        assert first.status_code == expected["status"]
        assert body.keys() == expected["body"].keys()
        assert body["user"].keys() == expected["body"]["user"].keys()
        assert body["user"]["id"] == str(user)
        assert (body["user"]["display_name"], body["user"]["email"]) == ("Test User", "test.user@example.com")
        assert body["first_sign_in"] is True
        assert later.json()["first_sign_in"] is False
        assert body["stats"] == expected["body"]["stats"]  # a new user has no forests yet
        assert {k: v for k, v in body["privacy"].items() if k != "updated_at"} == \
               {k: v for k, v in expected["body"]["privacy"].items() if k != "updated_at"}
    finally:
        purge_user(user)
