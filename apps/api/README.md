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

Contracts: `contracts/me.example.json` and `contracts/events.example.json`.
