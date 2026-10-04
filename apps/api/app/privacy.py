"""P-10: GET and PATCH /api/privacy (SPEC §10, contracts/privacy.example.json).

The extension writes excluded_domains and paused_until (EXCLUDE_DOMAIN and PAUSE, D-10) and reads them back after
sign-in; the Grove page writes retention_days and cloud_ai_enabled. PATCH changes only the fields it sends.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

import asyncpg
from fastapi import APIRouter, Depends
from pydantic import AwareDatetime, Field, field_validator

from app.auth import Principal, current_principal
from app.db import privacy_repository as store
from app.db import repository as repo
from app.errors import Problem
from app.routes import db_pool
from app.schemas import PrivacyOut, Strict, iso

router = APIRouter(prefix="/api", tags=["privacy"])

# A bare host name: lowercase letters, digits and hyphens in dot-separated labels (no scheme, port, path or wildcard).
_DOMAIN = re.compile(r"^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$")
MAX_PER_REQUEST = 100


def _domains(values: list[str] | None) -> list[str] | None:
    if values is None:
        return None
    out: list[str] = []
    for value in values:
        domain = value.strip().lower()
        if not _DOMAIN.match(domain):
            raise ValueError("must be a domain name such as example.com, without a scheme, port or path")
        if domain not in out:
            out.append(domain)
    return out


class PrivacyPatch(Strict):
    """Only the fields that are present change. paused_until: null resumes, a time pauses, the year 9999 means
    until resumed. A domain in both lists is a 422."""

    excluded_domains_add: list[str] | None = Field(default=None, max_length=MAX_PER_REQUEST)
    excluded_domains_remove: list[str] | None = Field(default=None, max_length=MAX_PER_REQUEST)
    paused_until: AwareDatetime | None = None
    retention_days: Literal[7, 30, 90] | None = None
    cloud_ai_enabled: bool | None = None

    _normalize = field_validator("excluded_domains_add", "excluded_domains_remove")(_domains)


def privacy_out(row: asyncpg.Record) -> PrivacyOut:
    paused: datetime | None = row["paused_until"]
    return PrivacyOut(excluded_domains=list(row["excluded_domains"]), paused_until=iso(paused),
                      retention_days=row["retention_days"], cloud_ai_enabled=row["cloud_ai_enabled"],
                      updated_at=iso(row["updated_at"]))


async def _provision(principal: Principal, conn: asyncpg.Connection) -> None:
    # GET /api/me normally creates the settings row; a first call to /api/privacy must not fail without it.
    await repo.ensure_user(principal.user_id, conn, entra_tid=principal.tid, entra_oid=principal.oid,
                           display_name=principal.name)


@router.get("/privacy", response_model=PrivacyOut)
async def get_privacy(principal: Principal = Depends(current_principal),
                      pool: asyncpg.Pool = Depends(db_pool)) -> PrivacyOut:
    async with pool.acquire() as conn:
        await _provision(principal, conn)
        row = await store.get_privacy(principal.user_id, conn)
    return privacy_out(row)


@router.patch("/privacy", response_model=PrivacyOut)
async def patch_privacy(body: PrivacyPatch, principal: Principal = Depends(current_principal),
                        pool: asyncpg.Pool = Depends(db_pool)) -> PrivacyOut:
    add, remove = body.excluded_domains_add or [], body.excluded_domains_remove or []
    both = next((d for d in add if d in remove), None)
    if both:
        raise Problem(422, f"{both} is in both excluded_domains_add and excluded_domains_remove")
    async with pool.acquire() as conn:
        await _provision(principal, conn)
        if not body.model_fields_set:  # nothing sent: nothing changes, not even updated_at
            return privacy_out(await store.get_privacy(principal.user_id, conn))
        try:
            row = await store.patch_privacy(
                principal.user_id, conn, add=add, remove=remove, set_paused="paused_until" in body.model_fields_set,
                paused_until=body.paused_until, retention_days=body.retention_days,
                cloud_ai_enabled=body.cloud_ai_enabled)
        except store.TooManyDomains:
            raise Problem(422, f"At most {store.MAX_EXCLUDED_DOMAINS} excluded domains") from None
    return privacy_out(row)
