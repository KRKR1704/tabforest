"""P's slowapi limiter (§4.9): events 60/min per user. R's routes use R's own limiter.

Keys are the user (set by current_principal) or, before sign-in, the client IP. Storage is in
memory, which is exact because the App Service runs one worker process.
"""

from __future__ import annotations

import math
import time

from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.errors import problem_response

EVENTS_LIMIT = "60/minute"
EVENTS_LIMIT_DETAIL = "Event ingest is limited to 60 requests per minute"
LOGIN_LIMIT = "10/minute"


def user_or_ip(request: Request) -> str:
    user_id = getattr(request.state, "user_id", None)
    return f"user:{user_id}" if user_id else f"ip:{get_remote_address(request)}"


limiter = Limiter(key_func=user_or_ip, strategy="moving-window", storage_uri="memory://")


def retry_after_s(request: Request) -> int:
    hit = getattr(request.state, "view_rate_limit", None)
    if not hit:
        return 60
    item, args = hit
    reset_at, _ = limiter.limiter.get_window_stats(item, *args)
    return max(1, math.ceil(reset_at - time.time()))


async def rate_limited(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return problem_response(request, 429, str(exc.detail), headers={"Retry-After": str(retry_after_s(request))})
