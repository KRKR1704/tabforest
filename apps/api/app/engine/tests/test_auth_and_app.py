"""Dev-header auth (BUILD_TASKS.md §4.1) and the standalone app."""

from fastapi.testclient import TestClient

PROBLEM_KEYS = {"type", "title", "status", "detail", "instance"}


def test_health(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "lane": "engine"}


def test_whoami_without_header_is_401_problem(client: TestClient, dev_mode: None) -> None:
    r = client.get("/api/_whoami")
    assert r.status_code == 401
    assert r.headers["content-type"].startswith("application/problem+json")
    body = r.json()
    assert set(body) == PROBLEM_KEYS
    assert body["status"] == 401 and body["instance"] == "/api/_whoami"
    assert "Missing X-Dev-User" in body["detail"]


def test_whoami_with_bad_uuid_is_401(client: TestClient, dev_mode: None) -> None:
    for value in ("not-a-uuid", "00000000000040008000000000000001", "{00000000-0000-4000-8000-000000000001}"):
        r = client.get("/api/_whoami", headers={"X-Dev-User": value})
        assert r.status_code == 401, value
        assert r.json()["detail"] == "X-Dev-User must be a UUID"


def test_whoami_with_valid_uuid(client: TestClient, dev_mode: None) -> None:
    r = client.get("/api/_whoami", headers={"X-Dev-User": "00000000-0000-4000-8000-00000000000A"})
    assert r.status_code == 200
    assert r.json() == {"user_id": "00000000-0000-4000-8000-00000000000a"}


def test_whoami_hidden_outside_dev(client: TestClient, prod_mode: None) -> None:
    r = client.get("/api/_whoami", headers={"X-Dev-User": "00000000-0000-4000-8000-000000000001"})
    assert r.status_code == 404
