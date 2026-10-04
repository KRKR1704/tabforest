"""Helpers shared by P's tests. Nothing here needs the network; database helpers need DATABASE_URL
(environment or apps/api/.env) and the tests that use them skip without it.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import asyncpg
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from dotenv import dotenv_values
from fastapi import FastAPI

from app.auth import EntraVerifier
from app.config import Settings
from app.limits import limiter
from app.main import create_app

API_DIR = Path(__file__).resolve().parents[1]
CONTRACTS = API_DIR.parents[1] / "contracts"
EXTENSION_ORIGIN = "chrome-extension://nldemblgfgcaolkpkajdbefjfnileeoi"
CLIENT_ID = "84bf8d79-85c2-463d-a8eb-c0a4d22bdb24"
PERSONAL_TID = "9188040d-6c67-4c5b-b112-36a304b66dad"  # Microsoft personal-account tenant
UNREACHABLE_DB = "postgresql://nobody:nothing@127.0.0.1:9/none"  # refused at once
P_TABLES = ("browser_events", "browser_sessions", "tabs", "saved_contexts", "privacy_settings", "users")


def contract(name: str) -> dict[str, Any]:
    return json.loads((CONTRACTS / name).read_text(encoding="utf-8"))


def example(doc: dict[str, Any], name: str) -> dict[str, Any]:
    return next(e for e in doc["examples"] if e["name"] == name)


def database_url() -> str | None:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env = API_DIR / ".env"
    return dotenv_values(env).get("DATABASE_URL") if env.exists() else None


requires_db = pytest.mark.skipif(database_url() is None, reason="DATABASE_URL not set")


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {"_env_file": None, "database_url": database_url() or UNREACHABLE_DB,
                              "allowed_extension_origin": EXTENSION_ORIGIN, "entra_client_id": CLIENT_ID,
                              "auth_mode": "prod"}
    values.update(overrides)
    return Settings(**values)


# A test signing key standing in for Microsoft's JWKS.
SIGNING_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
KID = "tabforest-test-key"


class StaticJWKS:
    def get_signing_key_from_jwt(self, token: str) -> SimpleNamespace:
        if jwt.get_unverified_header(token).get("kid") != KID:
            raise jwt.PyJWKClientError("kid not in key set")
        return SimpleNamespace(key=SIGNING_KEY.public_key())


def entra_token(*, tid: str = PERSONAL_TID, oid: str | None = None, aud: str = CLIENT_ID,
                iss: str | None = None, scp: str | None = "user_impersonation", exp_in: int = 3600,
                key: Any = None, kid: str = KID, omit: tuple[str, ...] = (), **extra: Any) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {"aud": aud, "iss": iss or f"https://login.microsoftonline.com/{tid}/v2.0",
                              "iat": now - 5, "nbf": now - 5, "exp": now + exp_in, "tid": tid,
                              "oid": oid or str(uuid.uuid4()), "scp": scp, "ver": "2.0",
                              "name": "Test User", "preferred_username": "test.user@example.com", **extra}
    for name in omit:
        claims.pop(name, None)
    if scp is None:
        claims.pop("scp")
    return jwt.encode(claims, key or SIGNING_KEY, algorithm="RS256", headers={"kid": kid})


def make_app(**overrides: Any) -> FastAPI:
    app = create_app(make_settings(**overrides))
    app.state.entra = EntraVerifier(app.state.settings, jwks=StaticJWKS())
    limiter.reset()
    return app


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _with_conn(fn):
    conn = await asyncpg.connect(database_url(), timeout=30)
    try:
        return await fn(conn)
    finally:
        await conn.close()


def db_run(fn) -> Any:
    """Run an async fn(conn) on a fresh connection."""
    return asyncio.run(_with_conn(fn))


def db_fetch(sql: str, *args: Any) -> list[asyncpg.Record]:
    return asyncio.run(_with_conn(lambda c: c.fetch(sql, *args)))


def db_val(sql: str, *args: Any) -> Any:
    return asyncio.run(_with_conn(lambda c: c.fetchval(sql, *args)))


def purge_user(user_id: uuid.UUID) -> None:
    """Remove a test user's rows from P's tables."""
    async def run(conn: asyncpg.Connection) -> None:
        async with conn.transaction():
            for table in P_TABLES:
                column = "id" if table == "users" else "user_id"
                await conn.execute(f"DELETE FROM {table} WHERE {column} = $1", user_id)  # noqa: S608
    asyncio.run(_with_conn(run))


@pytest.fixture
def user_id():
    """A fresh user id; its rows are removed from P's tables after the test."""
    uid = uuid.uuid4()
    yield uid
    if database_url():
        purge_user(uid)
