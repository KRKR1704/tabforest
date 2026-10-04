# Failure drills (P-16)

What happens when a dependency fails, run for real on 2026-10-04. Every result below is what the drill printed, not what was expected. Reproduce with:

```powershell
cd apps\api
uv run python scripts\failure_drills.py            # all four
uv run python scripts\failure_drills.py db ingest  # or some of them: db | ingest | azure | late
```

Each drill starts its own local API process (`AUTH_MODE=dev`, port 8790, this machine only). Drills 2 to 4 use the real Tiger Cloud database with a fresh user id and delete that user's rows afterwards. The deployed App Service was not touched.

## 1. Tiger Data down

Setup: `DATABASE_URL` points at a closed port.

| Request | Result |
| --- | --- |
| `POST /api/events` | `503`, `Retry-After: 30`, `application/problem+json`, detail "Event storage is temporarily unavailable" |
| `GET /api/me` | `503`, `Retry-After: 30`, detail "Storage is temporarily unavailable" |
| `GET /api/sessions` | `503`, `Retry-After: 30` |
| `GET /health` | `200 {"status":"ok"}` |

The process stays up and answers; nothing crashes. Observed cost: the 503 on `POST /api/events` took 6.3 seconds here, because the refused connection is retried before the pool gives up (Windows is slow to refuse; I have not measured Linux on App Service). The extension queue treats 503 as "retry later", so no event is lost.

## 2. Restart during ingest

Setup: one user, 20 batches of 50 events (1,000 unique events, one session) sent in order. The server process was killed (`kill -9` equivalent) right after batch 7 was acknowledged, then restarted.

| Step | Result |
| --- | --- |
| Acknowledged before the kill | batches 0 to 7 (400 events) |
| Not acknowledged | batches 8 to 19: `ConnectError` (server gone) |
| In the database when the server died | 400 events, 400 distinct ids, 1 session (event count 400) |
| Retry of the 12 unacknowledged batches after restart | 600 accepted, 0 duplicates |
| Then the whole stream resent (all 20 batches) | 0 accepted, 1,000 duplicates |
| Final | 1,000 events, 1,000 distinct event ids, 1 session, session event count 1,000 |

Result: no event lost and none duplicated; sessions and counts stayed exact.

Not shown by this run: the kill fell between batches, so no batch was caught half-way through its transaction. A batch is one transaction (events, sessions and tabs commit together), so a kill inside one rolls the whole batch back and the retry stores it; I did not catch that case happening.

## 3. Azure OpenAI down

Setup: `AZURE_OPENAI_API_KEY` set to a wrong value; `POST /api/grove/grow` with the 28 demo tabs.

| Field | Result |
| --- | --- |
| Status | `200`, in 1.1 seconds |
| `degraded` | `true` |
| `banner_text` | "AI unavailable — showing groups only" |
| Trees | 3, all fogged, 0 claims (stones, mushrooms, next actions) |
| Tree names | `engineer · software · tailspin`, `recipe · pan · lemon`, `jwt · refresh · fastapi` |
| `GET /api/grove` afterwards | `200`, `degraded: true` |

Result: the Seedling grove appears end to end. Note for the demo: with Azure fully unreachable (embeddings fail as well) the grouping is coarser, 3 groups instead of the 4 projects of the live run, and names are keyword labels. I only tested a wrong key; a network-level Azure outage was not tested.

## 4. Network drop, events flushed later

Setup: 20 events sent; the API was stopped for a few seconds (standing in for the dropped connection); then the queued batch (20 events, original `ts` and `event_id`) and a later batch were sent from the "queue", and the queued batch was retried as if its response had been lost.

| Step | Result |
| --- | --- |
| First batch | 20 accepted |
| Queued batch, flushed 8.1 seconds after the drop | 20 accepted |
| Later batch | 20 accepted |
| Queued batch retried | 0 accepted, 20 duplicates |
| Stored | 60 events, 60 distinct ids, first `ts` 09:00:00Z, last 09:09:50Z (the original times) |
| `GET /api/sessions` | one session, started 09:00:00Z, 60 events |

Result: events keep the timestamps they were created with and land in the right session, whenever they arrive.

Not tested here: the extension's own queue (retry timing, persistence across a browser restart) is Deep's code. This drill only covers what the API does with what the queue sends.
