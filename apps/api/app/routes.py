"""P's endpoints for Phase A (BUILD_TASKS.md §4.4): GET /api/me, POST /api/events and the
fallback POST /api/auth/login. Shapes follow contracts/me.example.json and events.example.json.
"""

from __future__ import annotations

from functools import lru_cache
from uuid import UUID

import asyncpg
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool

from app.adapters import intents
from app.adapters.events_in import tab_updates, to_row
from app.auth import FALLBACK_TTL_S, Principal, current_principal, current_user, issue_fallback_token
from app.db import repository as repo
from app.db.pool import STORAGE_ERRORS
from app.errors import unauthorized, unavailable
from app.limits import EVENTS_LIMIT, EVENTS_LIMIT_DETAIL, LOGIN_LIMIT, limiter
from app.schemas import (
    EventBatch,
    IngestResult,
    LoginRequest,
    LoginResponse,
    MeResponse,
    MeStats,
    MeUser,
    PrivacyOut,
    iso,
)

router = APIRouter(prefix="/api", tags=["platform"])
login_router = APIRouter(prefix="/api", tags=["auth"])


async def db_pool(request: Request) -> asyncpg.Pool:
    return await request.app.state.db.pool()


@router.get("/me", response_model=MeResponse)
async def get_me(principal: Principal = Depends(current_principal),
                 pool: asyncpg.Pool = Depends(db_pool)) -> MeResponse:
    """Profile, stats and privacy settings. The first call provisions the user (SPEC §11.3)."""
    async with pool.acquire() as conn:
        user, privacy, created = await repo.ensure_user(
            principal.user_id, conn, entra_tid=principal.tid, entra_oid=principal.oid,
            display_name=principal.name)
        stats = await intents.user_stats(principal.user_id, conn)
    return MeResponse(
        user=MeUser(id=user["id"], display_name=principal.name or user["display_name"],
                    email=principal.email, created_at=iso(user["created_at"])),
        first_sign_in=created,
        stats=MeStats(**stats),
        privacy=PrivacyOut(excluded_domains=list(privacy["excluded_domains"]),
                           paused_until=iso(privacy["paused_until"]),
                           retention_days=privacy["retention_days"],
                           cloud_ai_enabled=privacy["cloud_ai_enabled"],
                           updated_at=iso(privacy["updated_at"])))


@router.post("/events", status_code=202, response_model=IngestResult)
@limiter.limit(EVENTS_LIMIT, error_message=EVENTS_LIMIT_DETAIL)
async def post_events(request: Request, batch: EventBatch,
                      user_id: UUID = Depends(current_user)) -> IngestResult:
    """Idempotent batch ingest (§4.10): accepted + duplicates always equals the batch size."""
    rows = [to_row(event) for event in batch.events]
    try:
        pool = await request.app.state.db.pool()
        async with pool.acquire() as conn:
            accepted = await repo.ingest_events(user_id, conn, rows, tab_updates(rows))
    except STORAGE_ERRORS:
        raise unavailable("Event storage is temporarily unavailable") from None
    return IngestResult(accepted=accepted, duplicates=len(rows) - accepted)


@lru_cache(maxsize=1)
def _dummy_hash() -> str:
    # Unknown emails still pay for one argon2 verify, so response time doesn't reveal accounts.
    return PasswordHasher().hash("tabforest-no-such-account")


def _password_ok(stored_hash: str | None, password: str) -> bool:
    try:
        PasswordHasher().verify(stored_hash or _dummy_hash(), password)
    except (VerificationError, InvalidHashError):
        return False
    return stored_hash is not None


@login_router.post("/auth/login", response_model=LoginResponse)
@limiter.limit(LOGIN_LIMIT, error_message="Too many sign-in attempts; try again in a minute")
async def fallback_login(request: Request, body: LoginRequest) -> LoginResponse:
    """Fallback sign-in (SPEC §11.1), mounted only when FALLBACK_LOGIN=true. Accounts come from the
    FALLBACK_ACCOUNTS setting; there is no self-registration."""
    settings = request.app.state.settings
    email = body.email.strip().lower()
    stored = settings.fallback_account_hashes().get(email)
    if not await run_in_threadpool(_password_ok, stored, body.password):
        raise unauthorized("Email or password is incorrect")
    return LoginResponse(access_token=issue_fallback_token(settings, email), expires_in=FALLBACK_TTL_S)
