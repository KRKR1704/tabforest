"""User identity for the engine's routes (BUILD_TASKS.md §4.1).

The standalone app accepts only the dev header `X-Dev-User: <uuid>`. There is no JWT or
JWKS code here: when P mounts the router, P's main.py sets
`app.dependency_overrides[get_user_id] = current_user`, so production tokens are validated
by P's single implementation.
"""

from __future__ import annotations

import re
from uuid import UUID

from fastapi import Header

from ..problems import ProblemError

_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def _unauthorized(detail: str) -> ProblemError:
    return ProblemError(401, "Unauthorized", detail)


async def get_user_id(x_dev_user: str | None = Header(default=None, alias="X-Dev-User")) -> UUID:
    if not x_dev_user:
        raise _unauthorized("Missing X-Dev-User header")
    value = x_dev_user.strip()
    if not _UUID.match(value):
        raise _unauthorized("X-Dev-User must be a UUID")
    return UUID(value)
