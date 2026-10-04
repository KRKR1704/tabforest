"""The one production auth implementation (BUILD_TASKS.md §4.1, SPEC §11).

current_user() resolves a request to a user_id from:
- an Entra v2 access token (RS256): signature checked against Microsoft's JWKS (cached), aud = the
  API's client ID (X13), iss = https://login.microsoftonline.com/{tid}/v2.0 for the token's own tid,
  exp/nbf with at most 60 s of clock skew, scp containing user_impersonation (an ID token has the
  same aud but no scp), and tid + oid present (X14). user_id = uuid5(NAMESPACE_URL, "tabforest:"
  + tid + ":" + oid), so nobody needs a users lookup to know the user;
- a fallback token (HS256) from POST /api/auth/login, only when FALLBACK_LOGIN=true; sub = user_id;
- X-Dev-User: <uuid>, only when AUTH_MODE=dev (local runs and the H6.5 smoke test).
R's routes get the same function: main.py overrides R's get_user_id with current_user.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Literal
from uuid import NAMESPACE_URL, UUID, uuid5

import jwt
from fastapi import Depends, Header, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import MULTI_TENANT, Settings
from app.errors import unauthorized, unavailable

log = logging.getLogger("tabforest.auth")

LEEWAY_S = 60
API_SCOPE = "user_impersonation"
FALLBACK_ISSUER = "tabforest-fallback"
FALLBACK_AUDIENCE = "tabforest-api"
FALLBACK_TTL_S = 3600

MISSING = "Missing bearer token"
INVALID = "Invalid or expired token"
NO_IDENTITY = "Token has no tid or oid claim; request the profile scope"


@dataclass(frozen=True)
class Principal:
    user_id: UUID
    method: Literal["entra", "fallback", "dev"]
    tid: str | None = None
    oid: str | None = None
    name: str | None = None
    email: str | None = None


class TokenRejected(Exception):
    """Why a token failed. Logged; the client only sees a generic 401."""


class MissingIdentity(TokenRejected):
    pass


class KeysUnavailable(Exception):
    """Microsoft's key endpoint could not be reached."""


def entra_user_id(tid: str, oid: str) -> UUID:
    return uuid5(NAMESPACE_URL, f"tabforest:{tid}:{oid}")


def fallback_user_id(email: str) -> UUID:
    return uuid5(NAMESPACE_URL, f"tabforest:local:{email.strip().lower()}")


class EntraVerifier:
    def __init__(self, settings: Settings, jwks: jwt.PyJWKClient | None = None) -> None:
        self.audience = settings.audience
        self.tenant = settings.entra_tenant
        self.jwks = jwks or jwt.PyJWKClient(
            f"https://login.microsoftonline.com/{self.tenant}/discovery/v2.0/keys",
            cache_jwk_set=True, lifespan=3600, timeout=10)

    def verify(self, token: str) -> Principal:
        """Blocking on a JWKS cache miss; call it through run_in_threadpool."""
        try:
            key = self.jwks.get_signing_key_from_jwt(token).key
        except jwt.PyJWKClientConnectionError as exc:
            raise KeysUnavailable from exc
        except (jwt.PyJWKClientError, jwt.DecodeError) as exc:
            raise TokenRejected(f"signing key: {type(exc).__name__}") from exc
        try:
            claims: dict[str, Any] = jwt.decode(
                token, key, algorithms=["RS256"], audience=self.audience, leeway=LEEWAY_S,
                options={"require": ["exp", "iat", "iss", "aud"]})
        except jwt.InvalidTokenError as exc:
            raise TokenRejected(type(exc).__name__) from exc
        tid, oid = claims.get("tid"), claims.get("oid")
        if not tid or not oid:
            raise MissingIdentity("no tid or oid")
        if claims["iss"] != f"https://login.microsoftonline.com/{tid}/v2.0":
            raise TokenRejected("issuer does not match tid")
        if self.tenant not in MULTI_TENANT and tid != self.tenant:
            raise TokenRejected("tenant not allowed")
        if API_SCOPE not in str(claims.get("scp", "")).split():
            raise TokenRejected("scope user_impersonation missing")
        return Principal(entra_user_id(tid, oid), "entra", tid, oid,
                         claims.get("name"), claims.get("preferred_username"))


def issue_fallback_token(settings: Settings, email: str) -> str:
    now = int(time.time())
    claims = {"sub": str(fallback_user_id(email)), "email": email.strip().lower(), "iss": FALLBACK_ISSUER,
              "aud": FALLBACK_AUDIENCE, "iat": now, "nbf": now, "exp": now + FALLBACK_TTL_S}
    return jwt.encode(claims, settings.jwt_secret.get_secret_value(), algorithm="HS256")


def verify_fallback(settings: Settings, token: str) -> Principal:
    try:
        claims = jwt.decode(token, settings.jwt_secret.get_secret_value(), algorithms=["HS256"],
                            audience=FALLBACK_AUDIENCE, issuer=FALLBACK_ISSUER, leeway=LEEWAY_S,
                            options={"require": ["exp", "iat", "sub", "iss", "aud"]})
        user_id = UUID(claims["sub"])
    except (jwt.InvalidTokenError, ValueError) as exc:
        raise TokenRejected(type(exc).__name__) from exc
    return Principal(user_id, "fallback", email=claims.get("email"))


_bearer = HTTPBearer(auto_error=False, description="Entra access token (or fallback token)")


async def current_principal(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    x_dev_user: str | None = Header(default=None, include_in_schema=False),
) -> Principal:
    settings: Settings = request.app.state.settings
    if credentials is None or not credentials.credentials.strip():
        if settings.auth_mode == "dev" and x_dev_user:
            try:
                principal = Principal(UUID(x_dev_user), "dev")
            except ValueError:
                raise unauthorized("X-Dev-User must be a UUID") from None
            request.state.user_id = principal.user_id
            return principal
        raise unauthorized(MISSING)

    token = credentials.credentials.strip()
    try:
        alg = jwt.get_unverified_header(token).get("alg")
        if alg == "RS256":
            principal = await run_in_threadpool(request.app.state.entra.verify, token)
        elif alg == "HS256" and settings.fallback_login:
            principal = verify_fallback(settings, token)
        else:
            raise TokenRejected(f"algorithm {alg!r} not accepted")
    except MissingIdentity:
        raise unauthorized(NO_IDENTITY) from None
    except KeysUnavailable:
        raise unavailable("Sign-in keys are temporarily unavailable") from None
    except (TokenRejected, jwt.InvalidTokenError) as exc:
        log.info("token rejected: %s", exc)
        raise unauthorized(INVALID) from None
    request.state.user_id = principal.user_id
    return principal


async def current_user(principal: Principal = Depends(current_principal)) -> UUID:
    return principal.user_id
