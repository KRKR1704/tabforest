#!/bin/bash
# Starts the API on 127.0.0.1:8001 against $DATABASE_URL (set by harness.py), then runs one Playwright script.
#   usage (from apps/extension/e2e/full-stack): uv run --with pgserver --with asyncpg python harness.py ../../../../db/migrations ./run-full-stack.sh full-flow.mjs
# Needs: AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY (and the deployments) in the environment for the real model;
#        EXT = the prepared extension build (see prepare-build.mjs); Node 20, uv, `npm i playwright` in ../
set -e
SCRIPT=$1
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
cd "$ROOT/apps/api"
HASH=$(uv run python -c "from argon2 import PasswordHasher; print(PasswordHasher().hash('correct horse battery'))")
export ALLOWED_EXTENSION_ORIGIN=chrome-extension://nldemblgfgcaolkpkajdbefjfnileeoi ENTRA_CLIENT_ID=84bf8d79-85c2-463d-a8eb-c0a4d22bdb24 AUTH_MODE=prod FALLBACK_LOGIN=true
export JWT_SECRET=0123456789abcdef0123456789abcdef0123456789   # a test-only secret for the throwaway API
export FALLBACK_ACCOUNTS="{\"demo@example.com\": \"$HASH\"}"
uv run uvicorn app.main:create_app --factory --port 8001 > "${TMPDIR:-/tmp}/tabforest-full-stack-api.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; wait $PID 2>/dev/null || true' EXIT
for i in $(seq 1 60); do   # wait for the API (the first run also builds the Python environment)
  curl -s -o /dev/null http://127.0.0.1:8001/health && break
  sleep 2
done
curl -s -o /dev/null http://127.0.0.1:8001/health || { echo "the API did not start; see the log"; tail -20 "${TMPDIR:-/tmp}/tabforest-full-stack-api.log"; exit 1; }
export API_DIR="$ROOT/apps/api" DEMO_TABS="$ROOT/apps/api/app/engine/fixtures/demo_tabs.json" SAMPLE_DOCS="$ROOT/apps/api/app/engine/fixtures/sample_docs"
export SHOTS="${SHOTS:-${TMPDIR:-/tmp}/tabforest-full-stack-shots}"; mkdir -p "$SHOTS"
cd "$HERE" && node "$SCRIPT"
