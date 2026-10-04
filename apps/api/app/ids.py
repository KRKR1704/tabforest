"""Contract id prefixes (contracts/*.example.json). The database stores plain uuids; the API adds a
prefix on the way out and strips it on the way in. A malformed id is treated like an unknown one:
the route answers 404, never 422, so ids can't be probed by shape.
"""

from __future__ import annotations

from uuid import UUID

SESSION = "ses_"
PROJECT = "p_"
CONTEXT = "s_"
DECISION = "dec_"
QUESTION = "q_"
NOTE = "n_"


def out(prefix: str, value: UUID | str | None) -> str | None:
    return None if value is None else f"{prefix}{value}"


def parse(prefix: str, value: str) -> UUID | None:
    """The uuid behind a prefixed id, or None when the prefix or the uuid is wrong."""
    if not value.startswith(prefix):
        return None
    try:
        return UUID(value[len(prefix):])
    except ValueError:
        return None
