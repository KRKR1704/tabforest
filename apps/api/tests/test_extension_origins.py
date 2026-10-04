"""ALLOWED_EXTENSION_ORIGIN takes one or more origins: the development and the Chrome Web Store extension IDs differ."""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import create_app
from tests.helpers import EXTENSION_ORIGIN, make_settings

STORE_ORIGIN = "chrome-extension://efeifkhohbkiieogoglleehgcjgmjfep"
OTHER_ORIGIN = "chrome-extension://" + "a" * 32


def allow_origin(app, origin: str) -> str | None:
    response = TestClient(app).options(
        "/api/me", headers={"Origin": origin, "Access-Control-Request-Method": "GET",
                            "Access-Control-Request-Headers": "authorization"})
    return response.headers.get("access-control-allow-origin")


def test_one_origin_keeps_working():
    settings = make_settings(allowed_extension_origin=EXTENSION_ORIGIN)
    assert settings.allowed_extension_origins == [EXTENSION_ORIGIN]
    app = create_app(settings)
    assert allow_origin(app, EXTENSION_ORIGIN) == EXTENSION_ORIGIN
    assert allow_origin(app, STORE_ORIGIN) is None


def test_two_origins_both_get_cors_headers_and_a_third_gets_none():
    app = create_app(make_settings(allowed_extension_origin=f"{EXTENSION_ORIGIN}, {STORE_ORIGIN}/"))
    assert allow_origin(app, EXTENSION_ORIGIN) == EXTENSION_ORIGIN
    assert allow_origin(app, STORE_ORIGIN) == STORE_ORIGIN
    assert allow_origin(app, OTHER_ORIGIN) is None


def test_duplicates_collapse():
    settings = make_settings(allowed_extension_origin=f"{STORE_ORIGIN},{STORE_ORIGIN}")
    assert settings.allowed_extension_origins == [STORE_ORIGIN]


@pytest.mark.parametrize("bad", [
    f"{EXTENSION_ORIGIN},https://example.com",
    f"{EXTENSION_ORIGIN},",
    "chrome-extension://short",
    "chrome-extension://" + "z" * 32,
    "*",
])
def test_a_malformed_item_stops_startup(bad):
    with pytest.raises(ValidationError):
        make_settings(allowed_extension_origin=bad)
