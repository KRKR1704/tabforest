r"""Apply R's migrations (db/migrations/2xx_*.sql) to DATABASE_URL, then show R's schema.

Run from apps/api:
    .venv\Scripts\python app\engine\scripts\apply_r_migrations.py

Each file runs in one transaction. The files are idempotent (IF NOT EXISTS only), so running
this twice, or P's migrate.sh after it, changes nothing. Only R's tables are inspected; nothing
is dropped. DATABASE_URL is never printed.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from app.engine.settings import get_settings  # noqa: E402

MIGRATIONS = Path(__file__).resolve().parents[5] / "db" / "migrations"
R_TABLES = ("projects", "analysis_runs", "intent_clusters", "intent_branches", "cluster_tabs", "decisions",
            "unresolved_questions", "suggested_actions", "user_notes", "research_insights", "memory_embeddings")

SNAPSHOT_SQL = """
SELECT 'column' AS what, table_name AS tbl, column_name || ' ' || data_type AS detail
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[])
UNION ALL
SELECT 'index', tablename, indexname || ': ' || indexdef
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = ANY($1::text[])
UNION ALL
SELECT 'constraint', rel.relname, con.conname || ': ' || pg_get_constraintdef(con.oid)
  FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
 WHERE rel.relnamespace = 'public'::regnamespace AND rel.relname = ANY($1::text[])
"""


async def snapshot(conn: asyncpg.Connection) -> set[tuple[str, str, str]]:
    return {tuple(r) for r in await conn.fetch(SNAPSHOT_SQL, list(R_TABLES))}


async def main() -> int:
    settings = get_settings()
    if not settings.db_configured:
        print("DATABASE_URL is not set in apps/api/.env")
        return 2
    files = sorted(MIGRATIONS.glob("2[0-9][0-9]_*.sql"))
    conn = await asyncpg.connect(settings.database_url.get_secret_value(), timeout=30)
    try:
        before = await snapshot(conn)
        for path in files:
            async with conn.transaction():
                await conn.execute(path.read_text(encoding="utf-8"))
            print(f"applied {path.name} (one transaction)")
        after = await snapshot(conn)

        added = sorted(after - before)
        print(f"\nschema changes: {len(added)} added, {len(before - after)} removed")
        for what, tbl, detail in added[:12]:
            print(f"  + {what:<10} {tbl}: {detail[:110]}")
        if len(added) > 12:
            print(f"  ... {len(added) - 12} more")

        print("\nR tables (column count):")
        for table in R_TABLES:
            cols = sum(1 for w, t, _ in after if w == "column" and t == table)
            print(f"  {table:<22} {cols}")
        print("\nR indexes:")
        for _, tbl, detail in sorted(x for x in after if x[0] == "index"):
            name, definition = detail.split(": ", 1)
            shown = definition if "diskann" in definition else definition.split(" USING ", 1)[-1]
            print(f"  {tbl:<22} {name:<44} {shown}")
        print("\nCHECK constraints:")
        for _, tbl, detail in sorted(x for x in after if x[0] == "constraint" and ": CHECK" in x[2]):
            print(f"  {tbl:<22} {detail.split(': ', 1)[1]}")
    finally:
        await conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
