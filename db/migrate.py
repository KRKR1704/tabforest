"""Apply db/migrations/*.sql in name order (P's 1xx, then R's 2xx) and record each file in
schema_migrations, so a second run applies nothing (X10). Each file runs in its own transaction.

Every file is idempotent on its own (IF NOT EXISTS), so files R applied by hand before they were
recorded here are safe to run again.

    uv run --project apps/api python db/migrate.py            # apply pending files
    uv run --project apps/api python db/migrate.py --status   # list applied and pending files

DATABASE_URL comes from the environment, else apps/api/.env. It is never printed.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "db" / "migrations"


def database_url() -> str:
    load_dotenv(ROOT / "apps" / "api" / ".env", override=False)
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set (environment or apps/api/.env)")
    return url


async def run(status_only: bool) -> int:
    files = sorted(MIGRATIONS.glob("[0-9][0-9][0-9]_*.sql"))
    conn = await asyncpg.connect(database_url(), timeout=30)
    try:
        await conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations "
                           "(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
        applied = {r["version"] for r in await conn.fetch("SELECT version FROM schema_migrations")}
        pending = [f for f in files if f.name not in applied]
        if status_only:
            for f in files:
                print(f"{'applied' if f.name in applied else 'pending'}  {f.name}")
            return 0
        for f in pending:
            async with conn.transaction():
                await conn.execute(f.read_text(encoding="utf-8"))
                await conn.execute("INSERT INTO schema_migrations (version) VALUES ($1)", f.name)
            print(f"applied  {f.name}")
        print(f"{len(pending)} applied, {len(files) - len(pending)} already applied")
    finally:
        await conn.close()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--status", action="store_true", help="list applied and pending files, change nothing")
    return asyncio.run(run(parser.parse_args().status))


if __name__ == "__main__":
    sys.exit(main())
