"""The request clock. Routes take `now` from this dependency instead of calling datetime.now(), so
tests can pin it to the contracts' story clock (2026-10-04T11:40:00Z) with a dependency override.
"""

from __future__ import annotations

from datetime import UTC, datetime


def now() -> datetime:
    return datetime.now(UTC)
