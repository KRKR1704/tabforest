"""PRE-P2 check: connect to Tiger Cloud and list the installed extensions.

Run from the repo root:
    apps\\api\\.venv\\Scripts\\python apps\\api\\app\\engine\\scripts\\check_db.py

Reads DATABASE_URL from apps/api/.env and never prints it. Exits non-zero if the
variable is missing, the connection fails, or timescaledb, vector or vectorscale is absent.
"""

import asyncio
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

import asyncpg
from dotenv import load_dotenv

ENV_PATH = Path(__file__).resolve().parents[3] / ".env"
REQUIRED = ("timescaledb", "vector", "vectorscale")


def redact(text: str, url: str) -> str:
    parts = urlsplit(url)
    for secret in filter(None, (url, parts.password, parts.username, parts.hostname)):
        text = text.replace(secret, "<redacted>")
    return text


async def main() -> int:
    load_dotenv(ENV_PATH)
    url = os.environ.get("DATABASE_URL")
    if not url:
        print(f"DATABASE_URL is not set in {ENV_PATH}")
        return 2
    try:
        conn = await asyncpg.connect(url, timeout=20)
    except Exception as exc:  # noqa: BLE001 - report any connection failure without the URL
        print(f"connection failed: {type(exc).__name__}: {redact(str(exc), url)}")
        return 1
    try:
        print(f"server_version: {await conn.fetchval('SHOW server_version')}")
        rows = await conn.fetch("SELECT extname, extversion FROM pg_extension ORDER BY 1;")
    finally:
        await conn.close()
    print(f"{'extname':<20} extversion")
    for row in rows:
        print(f"{row['extname']:<20} {row['extversion']}")
    missing = [name for name in REQUIRED if name not in {row["extname"] for row in rows}]
    print(f"required {', '.join(REQUIRED)}: {'all present' if not missing else 'MISSING ' + ', '.join(missing)}")
    return 0 if not missing else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
