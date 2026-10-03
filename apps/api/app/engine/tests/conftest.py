"""Shared fixtures for the engine tests. Run from apps/api:

    .venv\\Scripts\\python -m pytest app/engine/tests -q
"""

import pytest
from fastapi.testclient import TestClient

from app.engine.settings import EngineSettings
from app.engine.standalone import app


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as c:
        yield c


@pytest.fixture
def dev_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.engine.routes.get_settings", lambda: EngineSettings(_env_file=None, auth_mode="dev"))


@pytest.fixture
def prod_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.engine.routes.get_settings", lambda: EngineSettings(_env_file=None, auth_mode="prod"))
