"""The API app (P-1): settings, CORS for the extension only, RFC 7807 errors, /health, P's routes,
and R's engine routes mounted with the auth override (§4.1, §4.4).

Run locally (PowerShell, from apps/api):
    uv run uvicorn app.main:create_app --factory --port 8000
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded

from app.auth import EntraVerifier, current_user
from app.config import Settings, load_settings
from app.db.pool import Database, StorageUnavailable
from app.deletion import router as deletion_router
from app.demo_pages import router as demo_router
from app.errors import install_error_handlers
from app.limits import limiter, rate_limited
from app.privacy import router as privacy_router
from app.retention import retention_loop
from app.routes import login_router, router
from app.routes_contexts import router as contexts_router
from app.routes_sessions import router as sessions_router
from app.routes_timeline import router as timeline_router
from app.telemetry import instrument, setup_telemetry

log = logging.getLogger("tabforest")

# The public landing page (apps/grove, npm run build:landing), copied here by the deploy job and served at
# /welcome/. It is a plain static folder with relative paths: no code, no data, no secrets.
WELCOME_SITE = Path(__file__).resolve().parent / "welcome_site"


def _configure_logging() -> None:
    if not log.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        log.addHandler(handler)
    log.setLevel(logging.INFO)


def mount_engine(app: FastAPI) -> bool:
    """Include R's router if it imports cleanly; P's app runs without it otherwise (§4.4)."""
    try:
        from app.engine.adapters.auth import get_user_id
        from app.engine.routes import router as engine_router
    except Exception as exc:  # noqa: BLE001 - any import failure leaves P's app running
        log.warning("engine routes not mounted (%s: %s); running without them", type(exc).__name__, exc)
        return False
    app.include_router(engine_router)
    app.dependency_overrides[get_user_id] = current_user
    log.info("engine routes mounted with the current_user override")
    return True


def _start_memory_loop() -> asyncio.Task | None:
    """Roopesh's research-memory pass (writes insights for dormant clusters and new saved contexts). Without
    it /api/memory/search has nothing to find for live users. An import failure leaves the app running."""
    try:
        from app.engine.memory import memory_loop
    except Exception as exc:  # noqa: BLE001
        log.warning("memory loop not started (%s: %s)", type(exc).__name__, exc)
        return None
    log.info("memory loop started (first pass in 5 minutes)")
    return asyncio.create_task(memory_loop())


async def _close_engine_pool() -> None:
    try:
        from app.engine.db import close_pool
    except Exception:  # noqa: BLE001
        return
    await close_pool()


def create_app(settings: Settings | None = None) -> FastAPI:
    _configure_logging()
    settings = settings or load_settings()
    telemetry_on = setup_telemetry(settings.applicationinsights_connection_string)
    if settings.auth_mode == "dev":
        for line in ("=" * 72, "AUTH_MODE=dev: X-Dev-User is accepted without a token.",
                     "Local runs and the H6.5 smoke test only. Never leave the deployed API on dev.", "=" * 72):
            log.warning(line)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.db = Database(settings.database_url.get_secret_value())
        try:
            await app.state.db.pool()
        except StorageUnavailable as exc:
            log.warning("database unreachable at startup (%s); requests get 503 until it is back", exc)
        retention = asyncio.create_task(retention_loop(app.state.db.pool))  # nightly per-user retention (P-10)
        memory = _start_memory_loop() if app.state.engine_mounted else None   # R-12: a pass every 5 minutes
        yield
        for task in (retention, memory):
            if task is not None:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
        await app.state.db.close()
        if app.state.engine_mounted:
            await _close_engine_pool()

    app = FastAPI(title="TabForest API", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.entra = EntraVerifier(settings)
    app.state.limiter = limiter
    install_error_handlers(app)
    app.add_exception_handler(RateLimitExceeded, rate_limited)

    allowed_headers = ["Authorization", "Content-Type"] + (["X-Dev-User"] if settings.auth_mode == "dev" else [])
    app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_extension_origins,
                       allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=allowed_headers,
                       max_age=600)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["X-Content-Type-Options"] = "nosniff"
        if request.url.path.startswith("/welcome"):
            response.headers.setdefault("Cache-Control", "public, max-age=300")    # the page and its hashed assets
        else:
            response.headers["Cache-Control"] = response.headers.get("Cache-Control", "no-store")
        return response

    @app.api_route("/health", methods=["GET", "HEAD"], tags=["system"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    if WELCOME_SITE.is_dir():
        app.mount("/welcome", StaticFiles(directory=WELCOME_SITE, html=True), name="welcome")

        @app.get("/", include_in_schema=False)
        async def root() -> RedirectResponse:
            """The bare address (tabforest.nyc) opens the landing page."""
            return RedirectResponse("/welcome/", status_code=307)
    app.include_router(demo_router)
    app.include_router(router)
    app.include_router(privacy_router)
    app.include_router(deletion_router)
    app.include_router(sessions_router)
    app.include_router(timeline_router)
    app.include_router(contexts_router)
    if settings.fallback_login:
        app.include_router(login_router)
        log.warning("fallback login is on (POST /api/auth/login)")
    app.state.engine_mounted = mount_engine(app)
    if telemetry_on:
        instrument(app)
    return app
