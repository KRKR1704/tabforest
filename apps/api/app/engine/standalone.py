"""R's endpoints running alone, for local work (BUILD_TASKS.md §4.1):

    cd apps/api
    .venv\\Scripts\\python -m uvicorn app.engine.standalone:app --port 8100

Accepts only the X-Dev-User header. Never deploy it; P's main.py mounts the router for real.
"""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .db import close_pool
from .memory import memory_loop
from .problems import install_problem_handlers
from .routes import router

log = logging.getLogger("tabforest.engine")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    log.warning("ENGINE STANDALONE: dev auth only (X-Dev-User header). Do not deploy this app.")
    task = asyncio.create_task(memory_loop())
    yield
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    await close_pool()


app = FastAPI(title="TabForest engine (standalone)", lifespan=lifespan)
install_problem_handlers(app)
app.include_router(router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "lane": "engine"}
