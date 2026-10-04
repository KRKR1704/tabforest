#!/usr/bin/env bash
# Apply db/migrations (P's 1xx, then R's 2xx), skipping files already recorded in schema_migrations.
# Used by CI (P-14). On Windows run: uv run --project apps/api python db/migrate.py
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec uv run --project "$ROOT/apps/api" python "$ROOT/db/migrate.py" "$@"
