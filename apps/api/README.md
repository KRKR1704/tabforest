# TabForest API

FastAPI app for lane P (platform) with lane R's engine routes mounted. Python 3.12, uv.

Commands below are PowerShell, run from `apps/api`.

## Setup

```powershell
uv sync
Copy-Item .env.example .env   # then fill in the values from the team password manager
```

`DATABASE_URL`, `ALLOWED_EXTENSION_ORIGIN` and `ENTRA_CLIENT_ID` are required; startup stops with
the variable's name if one is missing. `AUTH_MODE=dev` accepts the `X-Dev-User: <uuid>` header and is
for local runs and the H6.5 smoke test only.

## Run

```powershell
uv run uvicorn app.main:create_app --factory --port 8000
```

## Database

```powershell
uv run python ..\..\db\migrate.py --status   # applied and pending files
uv run python ..\..\db\migrate.py            # apply pending files (P's 1xx, then R's 2xx)
```

CI uses `db/migrate.sh`, which runs the same script.

## Tests

```powershell
uv run pytest            # contract tests in tests/; the database ones skip without DATABASE_URL
uv run ruff check .
```

## Endpoints so far

| Endpoint | Notes |
| --- | --- |
| `GET /health` | No auth |
| `GET /api/me` | Creates the user and default privacy settings on the first call |
| `POST /api/events` | Up to 500 events; idempotent by `(user_id, ts, event_id)`; 60 requests per minute per user |
| `POST /api/auth/login` | Fallback login; only when `FALLBACK_LOGIN=true` |
| `GET /api/privacy`, `PATCH /api/privacy` | Excluded domains, pause, retention (7/30/90 days), cloud AI. PATCH changes only the fields sent |
| `DELETE /api/projects/{id}` | Deletes a forest and everything derived from it; counts per table |
| `DELETE /api/me` | Deletes every row the user owns in every table, in one transaction; counts per table |

Contracts: `contracts/me.example.json`, `contracts/events.example.json` and `contracts/privacy.example.json`.

## Retention job

Users who chose 7 or 30 days of retention have their older events and sessions deleted nightly at 03:00 UTC, inside the API
process (the 90-day limit is the database policy's job). To run it once by hand: `uv run python -m app.retention`.

## Testing the database code without TimescaleDB

The tests that need `DATABASE_URL` create their own users and remove them again. To run them against a throwaway local
Postgres with pgvector instead of the shared database, load `db/migrations` into it without the TimescaleDB statements
(`create_hypertable`, the policies, the compression block, the `diskann` index; the continuous aggregates can be plain
materialized views with a `time_bucket` function and a `refresh_continuous_aggregate` procedure that refreshes them).
