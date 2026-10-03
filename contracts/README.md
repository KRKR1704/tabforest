# contracts/

Frozen at <FILL AT FREEZE>. Do not edit during the event.

Example payloads, not shared code (BUILD_TASKS.md §5.1). Each lane loads them into its own mocks and contract tests and keeps its own types. **Mismatches are fixed in the consumer's adapter, never here.** R freezes the folder with the git tag `contracts-frozen` (PRE-C1).

| File | Drafted by | Contents |
|---|---|---|
| `events.example.json` | P | One `POST /api/events` batch with `event_id`, `previous_tab_ref`, `dup_key`, `search_query`, plus the `{accepted, duplicates}` response |
| `snapshot.example.json` | D | The 28-tab open-tab snapshot in the §4.2 format |
| `grove.example.json` | R | Full `POST /api/grove/grow` response: trees, branches, leaves, mushrooms, stones, vines, fog, meadow, sprouts, fireflies, provenance, evidence |
| `grove.degraded.example.json` | R | The same grove in Seedling mode (`degraded: true`, deterministic labels, everything fogged, banner) |
| `grove.stream.example.ndjson` | R | The same grove as `clusters` → `tree` × n → `done` lines (§4.7) |
| `claims.example.json` | R | Requests and responses for claims (confirm, edit, dismiss, resolve), assign, notes, project analyze, and 404/422 errors |
| `timeline.example.json` | P | Timeline lanes with tab-switch, intent-switch and question/decision markers |
| `saved-context.example.json` | P | Save-context request, list, and resume card |
| `work-context.example.json` | R | `analyze` JSON request, `upload` multipart field description, the shared response with verified quotes, and a 413 error |
| `memory-search.example.json` | R | Found / not-found search results |
| `prune.example.json` | R | Prune suggestions and the four actions |
| `privacy.example.json` | P | Privacy get/patch |
| `me.example.json` | P | Profile |
| `sessions.example.json` | P | Sessions with tab and intent switch counts |
| `bridge.types.ts` | D | Type definitions for every message in §4.3 (request and reply) |
| `README.md` | R | This file |

## Conventions in R's files

- Keys are `snake_case`; files are UTF-8 with LF line endings.
- Request/response files hold `examples[]` of `{name, request, response, introduces}`. `introduces` lists the ids that response creates; every other id already exists in `grove.example.json` or the demo tab set (`apps/api/app/engine/fixtures/demo_tabs.json`, the same 28 tabs as `snapshot.example.json`).
- Every claim has `{id, text, provenance, confidence, display_text, evidence[{ref_kind, ref, why}]}`. No request body contains `user_id`; errors are RFC 7807 (`application/problem+json`).

## Regenerating R's files

R's JSON files and the demo tab set come from one generator. Do not hand-edit them; change the generator, regenerate, and check (from the repo root, before the freeze only):

```
apps\api\.venv\Scripts\python apps\api\app\engine\scripts\gen_contracts.py
apps\api\.venv\Scripts\python apps\api\app\engine\scripts\check_contracts.py
```
