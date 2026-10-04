# TabForest — Team Build Tasks

**GirlHacks 2026 · 4-person team · 24 hours · built from `TabForest_Proposal` v1.0 (all 32 sections) · plan v3**

Every task cites the proposal section it implements (for example `§14`). §14 of this file maps every proposal section back to tasks, so nothing is left without an owner.

---

## 1. Lanes and ownership

| Lane | Owner | Builds | Folders only this person edits |
|---|---|---|---|
| **R — Intelligence engine (core)** | R | The “why”: normalization, clustering, open-loop detection, Azure OpenAI reasoning, evidence validator, Work Context, research memory, pruning, and the AI endpoints | `apps/api/app/engine/` · `db/migrations/2xx_*.sql` · `docs/architecture.md` · `docs/metrics.md` |
| **S — Grove UI + pitch** | S | Every screen, the D3 Living Grove, the wow animation, accessibility, Devpost, pitch, demo script, backup video, README | `apps/grove/` · `docs/demo-script.md` · `devpost/` · `pitch/` · `README.md` |
| **D — Chrome extension** | D | MV3 service worker, tab capture, The Hollow, local cache and queue, Entra sign-in, open/close/restore tabs, Work Context capture, packaging the UI into the extension | `apps/extension/` · `docs/privacy.md` |
| **P — Platform + memory** | P | FastAPI app, auth, browser-event storage (hypertable + aggregates), sessions, timeline, saved contexts, privacy, deletion, isolation tests, Azure deployment, demo seed | `apps/api/app/` (everything except `engine/`) · `apps/api/tests/` · `db/migrations/1xx_*.sql` · `db/migrate.sh` · `infrastructure/azure/` · `.github/workflows/` · `apps/demo-seed/` · `docs/failure-drills.md` |

`contracts/` belongs to no lane during the event: each file is drafted by the person named in the §5.1 table, then R freezes the folder with the git tag `contracts-frozen`, and nobody edits it afterwards.

This follows the proposal's architecture (§11, §12, §25). Three changes to the §25 layout keep the lanes independent; they change no behaviour (details in §16 of this file):

- the Grove UI is its own package, `apps/grove`, which D bundles into the extension;
- there is no shared runtime package. Instead a small **frozen `contracts/` folder of example payloads** (§5.1) is written before the event, and every lane tests against those exact payloads while keeping its own types;
- migrations are numbered by owner (`1xx` P, `2xx` R) in the same `db/migrations/` folder.

---

## 2. Independence rules

1. **The proposal plus the frozen `contracts/` examples are the spec.** Every connection between lanes is defined in a proposal section (§3 of this file), settled in §4 of this file, and shown as an exact example payload in `contracts/` (§5.1). All three are frozen before the event; nobody edits them during it.
2. **Every lane builds its own stand-ins** (mock API, mock bridge, fake database rows) inside its own folder, **seeded from the `contracts/` examples**, so all four lanes test against identical payloads. Each lane keeps its own types (Pydantic or TypeScript). Nobody waits for anyone else's mock.
3. **One adapter file per connection, owned by the consumer.** When a real piece arrives, the consumer changes only their own adapter. Nobody edits another lane's files.
4. **Every adapter falls back to its stand-in** when the real thing is missing or failing (table not created yet, endpoint 404, API down). A late lane never breaks another lane's build or demo.
5. **Shared tables use column-level ownership** (§4.5 of this file). A lane writes only its own columns; anyone may read anything.
6. **No foreign keys across lanes.** Cross-lane references are plain `uuid` columns, so either side's migrations can run first.
7. Every task ends with a **Verify by** step on a real run, not just a passing build.

---

## 3. Connection map (who talks to whom, and where it is defined)

| # | Connection | From → To | Defined in proposal | Consumer's adapter |
|---|---|---|---|---|
| C1 | Event batches `POST /api/events` | D → P | §24 example, §7 columns, §13 `emit()` | P `app/adapters/events_in.py` |
| C2 | Bearer token (Entra, or fallback JWT) | D → P | §4 | P `app/auth.py` (the only production validator; R's routes use it when mounted, §4.1) |
| C3 | Grove `POST /api/grove/grow`, `GET /api/grove` | R → S | §24, §15, §12 step 10, §22 latency note | S `src/adapters/grove.ts` |
| C4 | Analyze, claims, assign, notes | R → S | §24, §5 interactions, §17 Tree Detail, §27 | S `src/adapters/grove.ts` |
| C5 | Memory search, prune suggestions | R → S | §24, §3.5, §3.6 | S `src/adapters/memory.ts` |
| C6 | Work Context analyze (JSON) and upload (multipart) | R → S, D | §6, §24 | S `src/adapters/workContext.ts` |
| C7 | Me, sessions, timeline, saved contexts, resume, privacy, delete | P → S | §24, §3.4, §9, §17 | S `src/adapters/platform.ts` |
| C8 | Grove page ↔ service worker messages | D ↔ S | §13 message passing (full list in §4.3) | S `src/adapters/bridge.ts` |
| C9 | Grove UI hosted in the extension | S → D | §11 primary interface, §13 | D `scripts/bundle-grove.mjs` |
| C10 | Exclusions sync `PATCH /api/privacy` | D → P | §9, §24 | P `app/adapters/privacy_in.py` |
| C11 | Raw events (incl. `session_id`, `previous_tab_ref`) + attention aggregate (read) | P → R | §7 SQL, §14 step 1, §16 | R `engine/adapters/stats.py` |
| C12 | Intent tables + cluster lookups (read) | R → P | §16, §7 timeline query, §3.4 importance, intent switches (§4.6) | P `app/adapters/intents.py` |
| C13 | Saved contexts (read, triggers research memory) | P → R | §3.2, §16 | R `engine/adapters/contexts.py` |
| C14 | Sample enterprise pages at `/demo/*` | P → D, R | §6, §21 setup | D and R use local copies until live |

---

## 4. Decisions the proposal leaves open, settled here

These fill gaps in the proposal so nobody has to ask another lane.

### 4.1 User identity and the single production auth
- `user_id = uuid5(NAMESPACE_URL, "tabforest:" + tid + ":" + oid)` from the Entra token's tenant ID and object ID, so nobody needs a lookup in P's `users` table to know the user.
- **There is exactly one production auth implementation: P's `current_user()`** (Entra JWKS validation + the fallback HS256 JWT with `sub = user_id`).
- R's routes depend on `engine.adapters.auth.get_user_id`, which in R's standalone app only accepts the dev header `X-Dev-User: <uuid>`. R writes **no** JWKS or JWT validation.
- When P's `main.py` mounts R's router, it also sets `app.dependency_overrides[get_user_id] = current_user`. That line lives in P's file, so neither lane edits the other's code, and P and R can never disagree about a token.
- Dev mode (`AUTH_MODE=dev`) accepts `X-Dev-User` in P's `current_user()` too, for local testing and the H6.5 smoke test.
- P creates the `users` row just-in-time on first `GET /api/me` (§4). R never needs that row to exist.

### 4.2 Open-tab snapshot sent to grow (§12 step 6, §14 steps 1–3, §24)
The proposal keeps full URLs on the device (§9), so the server cannot detect exact duplicates or read search parameters itself. The snapshot therefore carries:
- `tab_ref`, `domain`, `title` (already redacted), `opener_tab_ref`, `opened_at`, `active`, `pinned`;
- `dup_key`: SHA-256 of the normalized URL (scheme, `www`, trailing slash and tracking params removed). Equal keys mean an exact duplicate (§3.5, §14 step 3);
- `search_query`, parsed on device from the URL (`q=` and similar) before stripping (§13 `parseSearch`).
- At most 60 tabs: the 60 most recently focused (§14 step 1, §26).

Events in C1 carry the same `dup_key` and `search_query` fields, plus:
- **`event_id`: a UUID generated on the client when the event is created, before it is queued.** Retries resend the same `event_id` and `ts`, so the server can drop duplicates (§4.10);
- **`previous_tab_ref`** on `FOCUS` events: the tab that had focus just before (§4.6).

### 4.3 Bridge messages (§13)
Every reply is `{ ok, data?, error? }`.

| Message | Purpose |
|---|---|
| `GET_SNAPSHOT` | Open-tab snapshot as in §4.2 |
| `OPEN_TAB {tab_ref}` | Focus the tab, or reopen it from the local URL store |
| `CLOSE_TABS {tab_refs}` | Close tabs, only after an explicit user click |
| `RESTORE {tab_refs, group_name?, fallback_urls?}` | Reopen tabs; `fallback_urls` are the stripped URLs from a saved context, used when the local store has no entry |
| `GET_URLS {tab_refs}` | Stripped URLs, used when saving a grove (§9) |
| `SIGN_IN` · `SIGN_OUT` · `GET_AUTH_STATE` · `GET_TOKEN` | Sign-in state and the token for API calls |
| `PAUSE {until}` | Pause capture |
| `EXCLUDE_DOMAIN {domain}` | One-click exclusion from a leaf (§9) |
| `GET_HOLLOW_COUNT` | Count of tabs resting in the Hollow |
| `GET_SEND_PREVIEW` | Preview of the next batch to be sent |
| `GET_WORK_ITEMS` · `CLEAR_WORK_ITEMS` | Captured Work Context pages |
| `WIPE_LOCAL` | Clear all local extension storage |

The UI calls the API itself with `fetch` and the token from `GET_TOKEN`; the API base URL comes from the UI's env.

### 4.4 Endpoint ownership (§24)

| Owner | Endpoints |
|---|---|
| **R** | `POST /api/grove/grow` (plain JSON, or NDJSON stream with `?stream=1`) · `GET /api/grove` · `POST /api/projects/{id}/analyze` · `PATCH /api/claims/{id}` · `POST /api/tabs/{tab_ref}/assign` · `POST /api/notes` · `POST /api/tabs/prune-suggestions` · `GET /api/memory/search` · `POST /api/work-context/analyze` (`application/json`, page and paste items) · `POST /api/work-context/upload` (`multipart/form-data`: `files[]` plus optional `items_json` string) — both return the same Work Context response |
| **P** | `GET /api/me` · `DELETE /api/me` · `POST /api/events` · `GET /api/sessions` · `GET /api/sessions/{id}` · `GET /api/projects/{id}/timeline` · `POST /api/projects/{id}/save-context` · `GET /api/contexts` · `POST /api/contexts/{id}/resume` · `GET`/`PATCH /api/privacy` · `DELETE /api/projects/{id}` · `POST /api/auth/login` (fallback) · `/demo/*` · `/health` |

How R's endpoints join P's app: P's `main.py` includes `app.engine.routes:router` if the module imports cleanly (and logs a warning otherwise), and applies the auth override from §4.1. R can run his endpoints alone with `uvicorn app.engine.standalone:app`. Neither edits the other's files.

Both lanes return RFC 7807 errors, use `extra="forbid"` on request bodies (a body containing `user_id` returns 422), and return 404 for another user's resource (§4, §26).

### 4.5 Table and column ownership (§16)

| Owner | Tables |
|---|---|
| **P** | `users`, `privacy_settings`, `browser_sessions`, `browser_events` (hypertable), `tabs`, `saved_contexts`; aggregates `tab_attention_15m`, `user_attention_daily`, `search_activity_1h` |
| **R** | `projects`, `intent_clusters`, `intent_branches`, `cluster_tabs`, `research_insights`, `decisions`, `unresolved_questions`, `suggested_actions`, `user_notes`, `memory_embeddings`, `analysis_runs` (a **normal table**; AI-quality trends live in Application Insights, §4.8) |

Shared columns:
- **`tabs`:** P creates the table and writes `tab_ref`, `user_id`, `domain`, `first_seen` and `last_focus`. R writes `title_norm`, `source_type` and `embedding_hash` with `UPDATE` only.
- **`browser_events`:** per the proposal's §7 columns, except `is_context_switch` is replaced by the factual pair `previous_tab_ref` and `is_tab_switch` (§4.6). Unique key `(user_id, ts, event_id)`.
- **`saved_contexts`:** P adds a `kind` column (`resume` | `references`) to support “Save as references” (§3.5).
- **Unresolved questions** use `status` `open` | `resolved`, plus `answer` and `resolved_at`, so a mushroom can become a flower (§5).

### 4.6 Tab switches at ingest, intent switches later (§7)
At ingest time most tabs have no cluster yet, so P records only facts:
- `previous_tab_ref`: the tab focused just before (sent by D);
- `is_tab_switch = true` when focus moved to a different tab.

`tab_attention_15m` counts these as `tab_switches`.

**Intent switches are derived later, at query time**, once R's clusters exist: a tab switch counts as an intent switch only when `previous_tab_ref` and `tab_ref` belong to different clusters in `cluster_tabs` (read through C12). Tabs in the same cluster (FastAPI docs → Stack Overflow → GitHub, all Backend Authentication) are tab switches, not intent switches. Tabs with no cluster yet are reported as “unassigned”, never guessed from domains. P computes intent switches in the session and timeline queries, so user corrections to clusters apply immediately.

### 4.7 Streaming grow (§14 step 11, §22)
`POST /api/grove/grow?stream=1` returns NDJSON lines in this order:
1. `{type:"clusters", ...}` — as soon as deterministic clustering finishes;
2. `{type:"tree", ...}` — one per cluster, as each AI result lands;
3. `{type:"done", run_id, degraded}`.

Without `?stream=1`, the endpoint returns the full §24 response in one piece.

### 4.8 Telemetry (§8, §28)
- P configures the Azure Monitor OpenTelemetry distro in `main.py`.
- R emits custom metrics through the OpenTelemetry API: `grow_latency_ms`, `claims_downgraded`, `fallback_used`, `validation_failures`. If telemetry isn't configured, these calls do nothing.
- AI-quality trends (downgrade rate, fallback rate) are charted from these metrics in Application Insights, not from a database aggregate.
- Logs never contain titles or page text (§26).

### 4.9 Rate limits and caps (§26)
Each lane creates its own slowapi limiter on its own routes:

| Lane | Limits and caps |
|---|---|
| **P** | events 60/min |
| **R** | grow 10/min · work-context analyze + upload 5/min combined · ≤ 60 tabs and ≤ 8 LLM calls per run · daily token budget per user |

### 4.10 Idempotent event ingest
- The extension never mints a new `event_id` on retry.
- P inserts with batched `INSERT … ON CONFLICT (user_id, ts, event_id) DO NOTHING` (or `COPY` into a staging table followed by the same `INSERT … SELECT … ON CONFLICT DO NOTHING`). Batches are at most 500 rows, so plain batched inserts are fast enough.
- The response is `{ accepted, duplicates }`.
- Sending the identical batch twice must leave event counts **and** attention aggregates unchanged.

### 4.11 Sessions have one owner
P is the only owner of sessionization (`browser_sessions`, 30-minute gap rule, `session_id` on every stored event). R reads `session_id` through C11 and never computes its own sessions. If the engine needs finer segments it may compute **research phases** inside a cluster, which are R's own concept and never written to `browser_sessions`.

---

## 5. Before the event (accounts and assets, no product code)

| ID | Owner | Task | § | Verify by |
|---|---|---|---|---|
| PRE-R1 | R | Azure OpenAI resource with a chat deployment that supports Structured Outputs and `text-embedding-3-small`. Turn on the content filter with Prompt Shields. Check quota. | §8, §26 | One `curl` per deployment returns JSON |
| PRE-R2 | R | Write the labeled **SAMPLE** enterprise docs as Markdown: Jira ticket CAM-142, PR #418 thread, Teams transcript (decision at 00:14:32), migration doc, customer note. Put them in the password-manager share so P and D can copy them. | §6, §21 | Files shared |
| PRE-P1 | P | Resource group, App Service (Linux B1, HTTPS-only), Application Insights. Deploy a hello-world FastAPI `/health` with CORS allowing the fixed extension origin from PRE-D1. | §8, §11 | Portal screenshot; `curl …/health` → 200 |
| PRE-P2 | P | Tiger Cloud service with `timescaledb`, `vector` and `vectorscale`. Give R a connection string (`sslmode=require`). | §7, §26 | `SELECT extname FROM pg_extension;` |
| PRE-P3 | P | Entra app registration (personal + work/school accounts), scope `api://tabforest/user_impersonation`, redirect URI from PRE-D1. | §4 | Client ID and tenant in the password manager |
| PRE-D1 | D | Fixed extension key so the extension ID is stable; store the ID for P. | §11 | ID stored |
| PRE-D2 | D | **Networking preflight:** an unpacked extension with the final fixed ID fetches the deployed `https://…azurewebsites.net/health` from an extension page and from the service worker. Proves CORS, extension origin, CSP, HTTPS and that no host permission is needed. | §13, §26 | Screenshot of the 200 response in the extension's DevTools |
| PRE-S1 | S | [x] **Visual Design & Pitch Prep:** Moodboard (palette, Lora + Inter, tree/mushroom/stone/fog shapes), Devpost skeleton, first draft of `docs/demo-script.md` (which 28 tabs, in what order). | §17, §21 | Link shared |
| PRE-ALL | All | Node 20, pnpm, Python 3.12, uv, Azure CLI; GitHub accounts added to the repo. | §11 | `pnpm -v && uv -V && az -v` |

Only D-6 (sign-in) and P-1 (deploy) need these during the event, and both have fallbacks.

### 5.1 Frozen `contracts/` folder (written before the event, then never edited)

These are example payloads, not shared code. Each lane loads them into its own mocks and contract tests, and keeps its own types. Nobody waits on them during the event because they exist before H0.

| File | Drafted by | Contents |
|---|---|---|
| `contracts/events.example.json` | P | One `POST /api/events` batch with `event_id`, `previous_tab_ref`, `dup_key`, `search_query`, plus the `{accepted, duplicates}` response |
| `contracts/snapshot.example.json` | D | The 28-tab open-tab snapshot in the §4.2 format |
| `contracts/grove.example.json` | R | Full `POST /api/grove/grow` response (§24/§15): trees, branches, leaves, mushrooms, stones, vines, fog, meadow, sprouts, provenance, evidence |
| `contracts/grove.stream.example.ndjson` | R | The same grove as `clusters` → `tree` × n → `done` lines (§4.7) |
| `contracts/claims.example.json` | R | Requests and responses for claims, assign and notes |
| `contracts/timeline.example.json` | P | Timeline lanes with tab-switch, intent-switch and question/decision markers |
| `contracts/saved-context.example.json` | P | Save-context request, list, and resume card |
| `contracts/work-context.example.json` | R | `analyze` JSON request, `upload` multipart field description, and the shared response with verified quotes |
| `contracts/memory-search.example.json` · `prune.example.json` | R | Found / not-found search results; prune suggestions |
| `contracts/privacy.example.json` · `me.example.json` · `sessions.example.json` | P | Privacy get/patch, profile, sessions with tab and intent switch counts |
| `contracts/bridge.types.ts` | D | Type definitions for every message in §4.3 (request and reply) |
| `contracts/README.md` | R | “Frozen at <date/time>. Do not edit during the event.” |

PRE-C1 (all, before the event): each person drafts their files, S checks that the UI examples cover every screen, and R freezes the folder with a git tag `contracts-frozen`. Any mismatch found later is fixed in the consumer's adapter (rule 3), never by editing `contracts/`.

---

## 6. Lane R — Intelligence engine (core)

R works in `apps/api/app/engine/` with his own fixtures and talks to Tiger Data directly. He needs nothing from the UI, the extension or P's code to make progress.

| ID | Hours | Task | § | Verify by |
|---|---|---|---|---|
| R-1 | 0:00–1:00 | uv project, pytest, Azure OpenAI client, settings. **Own fixtures** from the proposal: 28-tab snapshot in the §4.2 format (auth, hackathon, job search, random), 2 hours of events, user notes, the SAMPLE docs. Load the `contracts/` examples as fixtures. Adapters: `auth.py` (dev header only, §4.1), `stats.py`, `contexts.py` (both on fixtures for now). `standalone.py` app for running alone. Contract tests: R's responses validate against the `contracts/` grove, work-context, memory and prune examples. | §11, §25 | `pytest` runs, including contract tests; standalone `/health` works |
| R-2 | 1:00–2:00 | **Normalize:** strip site suffixes from titles; source-type classifier by domain (docs, Q&A, code, discussion, video, search, work-tool); search-query fallback from search-result titles; exact-duplicate groups from `dup_key`. | §14 steps 2–3 | Tests on 20 real titles |
| R-3 | 2:00–2:45 | **R migrations** (`2xx_*.sql`): R's tables from §4.5 with no cross-lane foreign keys; `analysis_runs` as a normal table; `memory_embeddings vector(1536)` with a DiskANN index and a unique `content_hash`. Apply on Tiger Cloud. | §7, §16 | Tables and index exist |
| R-4 | 2:45–3:30 | **Embeddings:** string `"{title} \| {domain} \| {source_type}"`, batched calls, cached by SHA-256 in `memory_embeddings` (`kind='tab'`). | §14 step 4 | Second run makes 0 API calls |
| R-5 | 3:30–5:00 | **Clustering:** affinity = 0.65·cosine + 0.20·opener edge + 0.15·opened within 3 min; average-linkage agglomerative clustering at distance 0.45. Singletons go to the Wildflower Meadow; search tabs join the cluster they led to. **User assignments (`assigned_by='user'`) are pinned.** A tab may belong to two clusters. **Sprouts:** clusters under 30 minutes old with fewer than 3 tabs. **Match to an existing project** by centroid similarity (`is_existing_project_id`). | §3.1, §5, §14 step 5, §15, §27 | Fixture → 4 clusters + meadow; ARI vs hand labels ≥ 0.6; a pinned tab stays put |
| R-6 | 5:00–6:00 | **Features:** query families (cosine ≥ 0.80) flagged as open loops at ≥ 3 rephrasings in 2 h with no follow-up focus > 90 s; unresolved comparisons; dormant mid-comparison; research phases inside a cluster if needed, using P's `session_id` (R never computes sessions, §4.11); stale (no focus for 3+ days); distractions (< 10 s); dwell share; revisits; importance = 0.45·dwell + 0.25·evidence + 0.2·revisits + 0.1·official. | §3.3, §3.4, §3.5, §14 step 6 | Refresh-token family flagged; importance ranks the official docs first |
| R-7 | 6:00–8:00 | **Inference:** Pydantic models for the §15 schema → strict Structured Outputs; one call per cluster, in parallel; system prompt with untrusted-DATA framing (§14 prompt shape); short refs `t*/q*/n*/d*`. **Prior research:** the top 3 past insights with similarity ≥ 0.78 are passed in (step 7). | §14 steps 7–8, §15 | A real Azure call returns schema-valid JSON for every cluster |
| R-8 | 8:00–10:00 | **Validator + grow endpoint:** drop refs not in the cluster; `stated` only with a real `user_note_id`; `sourced` only with a verbatim-verified quote; confidence = min(model, 0.35 + 0.15·refs + 0.10·source types, 0.95); below 0.60 → hypothesis/fog; display wording set by provenance (“appears to…”, “Maybe:…”). `POST /api/grove/grow` (plain + stream, §4.7) persists everything in one transaction, updates R's `tabs` columns, writes `analysis_runs`, emits metrics (§4.8), applies limits (§4.9). `GET /api/grove` returns the last result. | §2, §12 steps 7–9, §15, §22, §24 | `curl` the standalone app with `X-Dev-User` → real grove; stream shows clusters before trees |
| — | 10:00–11:00 | **Rest** | | |
| R-9 | 11:00–11:45 | **Seedling fallback:** one retry, then deterministic labels from top shared terms, everything fogged, `degraded: true`; one repair retry on invalid JSON. **2–3 tabs:** sprouts, and one LLM call only if confidence ≥ 0.6. | §8, §27 | Wrong key → grove still returns; a 3-tab snapshot returns sprouts |
| R-10 | 11:45–13:00 | `POST /projects/{id}/analyze`; `PATCH /claims/{id}` (confirm turns inferred into stated with a note, edit, dismiss, resolve a question with an answer); `POST /tabs/{ref}/assign` (pins); `POST /api/notes` (“Clear the fog”: naming a goal creates a stated note). | §5, §17, §24, §27 | Scripted round trip; confirmed stone becomes `stated` |
| R-11 | 13:00–14:30 | **Work Context:** `POST /api/work-context/analyze` (JSON items: page and paste) and `POST /api/work-context/upload` (multipart: `files[]` PDF/TXT/MD/VTT ≤ 5 MB and ≤ 30 pages each, plus optional `items_json`; text parsed in memory and never stored). Both call the same extractor with ≤ 12,000 chars per item. Returns goal, decisions, blockers, owners, open questions and ranked next actions, each with provenance and a verified quote, plus handoff brief text. | §6, §26 | SAMPLE docs → “Azure Functions” decision with the 00:14:32 quote; blocker “credentials” |
| R-12 | 14:30–15:30 | **Research memory:** a background task every 5 minutes writes a research insight for clusters dormant for 30 minutes and for new `saved_contexts` rows (read through C13), then embeds it. `GET /api/memory/search` with threshold 0.78, honest “not found”, joined to attention minutes. | §3.2, §3.6 | Seeded March 12 insight found by “session storage”, not by “recipe” |
| R-13 | 15:30–16:15 | **Prune suggestions:** exact duplicates (`dup_key`), semantic redundancy (same branch, similarity ≥ 0.90), strongest source by dwell + source type, stale, distractions, one-line reasons. | §3.5 | The two redundant JWT articles flagged; official docs kept |
| R-14 | 16:15–17:00 | **Prompt-injection suite:** malicious title and page text fixtures; Prompt Shields flags → input dropped, cluster fogged; no tools; daily token budget. | §26 | Injection fixtures produce no `stated` decision |
| R-15 | 17:00–18:00 | Switch `stats.py` and `contexts.py` to P's real tables (attention, `session_id`, `previous_tab_ref`); if they're missing, stay on fixtures. Confirm R's routes work under P's auth override (§4.1) with a real Entra token. Run the full pipeline on real events from D's browser. | §4, §14 step 1 | Trunk sizes reflect real attention; mounted routes accept the same token as P's routes |
| R-16 | 18:00–19:30 | **Quality pass with the hallway test (§28):** run on 3–5 real tab sets; record ARI, label rating, time to resume, restore precision, redundancy precision, open-question accuracy, correction rate, downgrade rate and p50 latency in `docs/metrics.md`. Write `docs/architecture.md`. | §28 | Both files committed |
| R-17 | 19:30–21:30 | Latency (target p50 ≤ 4 s), bug buffer, owner of end-to-end demo runs. | §22 | Three clean full runs in a row |

---

## 7. Lane S — Grove UI + pitch

S builds `apps/grove/` as a standalone Vite web app with their own mock API, built from the proposal's §24 and §15 examples, plus a mock bridge. Neither the backend nor the extension is needed.

| ID | Hours | Task | § | Verify by |
|---|---|---|---|---|
| S-1 | 0:00–1:00 | [x] **Grove Foundation:** React 18, TypeScript, Vite, Tailwind, Zustand, TanStack Query. Mock API and mock bridge serve the **`contracts/` examples** for every C3–C8 response (including the NDJSON stream) and implement `contracts/bridge.types.ts`. Adapters switch with `VITE_MOCK=1`. | §11 | Page shows contract example data |
| S-2 | 1:00–2:00 | [x] **App shell:** left rail (Current Grove, Timeline, Saved Groves, Work Context, Ask Memory, Privacy), top bar (Grow grove, open-question count, “Have I researched…?” box), design tokens, `ProvenancePill`, `EvidenceDrawer`. Model and page text is only ever rendered as text (no `innerHTML`). | §17, §26 | Screenshot |
| S-3 | 2:00–5:00 | [x] **D3 Living Grove:** `GroveCanvas` (React owns the panel, D3 owns the `<svg>`); d3-hierarchy layout; parameterized trees; trunk = attention minutes; amber canopy when dormant 3+ days; leaf size = dwell; zoom and pan; Wildflower Meadow; Unclear fog patch; sprouts at the edge. | §5, §17 | 4 trees, meadow, fog, sprouts; zoom works |
| S-4 | 5:00–6:30 | [x] **Forest elements:** mushrooms (size = recurrence), stones (carved = stated/sourced, mossy = inferred), vines (thicker for exact duplicates), fallen leaves, flowers, fireflies drifting to past groves, fog density = 1 − confidence, a faint vine for a tab shared by two trees. `<title>` on every element; icon plus label, never color alone. | §5 | Every element clickable with a tooltip |
| S-5 | 6:30–9:00 | [x] **Tree Detail:** goal, direction, decisions, open questions, next actions, sources, all with provenance pills; roots light up to the exact evidence leaves; Confirm / Edit / Dismiss; Mark resolved (mushroom becomes a flower); add note; Clear the fog; drag a leaf to another tree or to a new tree; Exclude domain from a leaf (`EXCLUDE_DOMAIN`); leaf click → `OPEN_TAB`. | §2, §5, §9, §17, §27 | Correct requests in the network tab |
| S-6 | 9:00–10:00 | [x] **Grow orchestration controller (S owns the whole flow):** on Grow (and on first open), S calls `GET_SNAPSHOT`, `GET_HOLLOW_COUNT` and `GET_TOKEN` over the bridge, sends the snapshot to `POST /api/grove/grow?stream=1`, starts the animation when the `clusters` line arrives, updates each tree individually as its `tree` line arrives, and finishes on `done` (degraded banner if `degraded`). Keep the last grove locally and show it when the API is down. `pnpm build` produces static `dist/` (relative paths, no inline scripts, CSP-safe). | §12 steps 6–10, §22, §27 | Mock flow: bridge calls happen in order, trees fill one by one; `dist/` opens from a static server |
| — | 10:00–11:00 | **Rest** | | |
| S-7 | 11:00–12:00 | [x] **Timeline:** lanes per branch, markers for when a question first appeared and when a decision was made, hover shows tabs and minutes, “memory reconnecting” state. | §7, §17, §27 | Shows the 9:00 → 11:10 story |
| S-8 | 12:00–13:00 | [x] **Saved Groves + Resume:** save (calls `GET_URLS`, then save-context), cards with last active / time invested / open questions, resume card pinned at the top of the grove, Restore important (with `fallback_urls`) / Restore all / Just read summary. | §3.4, §9, §17 | Restore sends the right refs |
| S-9 | 13:00–14:00 | [x] **Work Context:** captured pages (`GET_WORK_ITEMS`) and paste go to `/work-context/analyze`; files go to `/work-context/upload` (with the other items in `items_json`); Reconstruct, enterprise card with quotes, Copy handoff brief, Save as work context. | §6, §17 | Fixture renders with quotes |
| S-10 | 14:00–15:00 | [x] **Privacy:** pause (1 h / until tomorrow / until resumed), Hollow categories, excluded domains, retention 7/30/90, live “what we send” preview, delete one forest, delete all (confirm dialog → API delete + `WIPE_LOCAL`). | §9, §17 | Requests and bridge calls correct |
| S-11 | 15:00–15:30 | [x] Ask-memory result card (firefly); prune dialog (Keep all / Close selected / **Save as references** → save-context `kind=references` + `CLOSE_TABS` / Prune branch). | §3.5, §3.6 | Fixtures render; nothing closes without a click |
| S-12 | 15:30–17:00 | [x] **Wow animation** exactly as §22: leaves fall 0–0.6 s, swirl 0.6–1.6 s (d3-force), trunks grow 1.6–2.4 s, canopy 2.4–3.2 s, labels type in and mushrooms/stones/fog/firefly appear 3.2–4.2 s. Late trees shimmer; reduced-motion fallback is a 300 ms fade. | §22 | Screen recording shared |
| S-13 | 17:00–17:45 | Sign-in screen with the three-line privacy promise; 3-step first-run onboarding; Outline view; keyboard focus order; empty state for 2–3 tabs (“TabForest learns as you browse”). | §4, §17, §27 | Each state reachable |
| S-14 | 17:45–18:15 | Switch adapters to the real API (`VITE_MOCK=0`) one by one; fix differences inside `adapters/` only; anything not live stays on mock. | §2 of this file | Live endpoints render |
| S-15 | 18:15–19:15 | **Devpost:** inspiration, what it does, how we built it (Azure and Tiger Data sections aimed at those judges), challenges, accomplishments, what's next (§30), built-with list, screenshots, architecture image from §12. | §19, §20, §30 | Draft link; R checks technical claims |
| S-16 | 19:15–20:30 | **Pitch:** `docs/demo-script.md` with the §21 narration adapted to who speaks; four 20-second track pitches (§20); persona slide (§18); competitive table (§19); judge Q&A cheat sheet; metrics slide from R-16; facilitate the §28 hallway test with R. | §18–§21, §28 | Timed read-through under 3:00 |
| S-17 | 20:30–21:30 | **README** (setup, screenshots, Limited Use statement from `docs/privacy.md`); **backup demo video** (2 min) on the integrated build, or the mock build if needed, kept open on a second laptop. | §9, §21 | Video link; README renders |
| S-18 | 22:30–24:00 | Lead 5 timed rehearsals; submit Devpost. | §21 | Submission confirmation |

---

## 8. Lane D — Chrome extension

D builds `apps/extension/` with his own mock API (accepts batches, returns §24 examples) and a placeholder Grove page, so capture, sync and sign-in are testable with no other lane.

| ID | Hours | Task | § | Verify by |
|---|---|---|---|---|
| D-1 | 0:00–1:00 | MV3 + Vite + CRXJS + TypeScript. Manifest exactly per §13: `tabs, storage, idle, identity, contextMenus, activeTab, scripting`; optional `tabGroups`; `incognito: not_allowed`; strict CSP; fixed key; no content scripts; no host permissions. Toolbar opens `grove.html` (placeholder). Own mock API on `:8001`. | §13, §31 | Icon opens placeholder; ID matches |
| D-2 | 1:00–3:00 | **Capture:** created, activated, updated (title or URL settled), removed, window focus, idle (60 s); focus tracker computing `active_ms`; `tab_ref` minting; opener refs; `dup_key` and `search_query` (§4.2); snapshot of open tabs on install and startup. **Every event gets a client-generated `event_id` (UUID) when it is created, before it is queued; `FOCUS` events carry `previous_tab_ref`.** Snapshot and events match `contracts/snapshot.example.json` and `events.example.json`. | §13, §14 step 3, §4.10 | Correct event stream in the worker console; every event has a unique `event_id` |
| D-3 | 3:00–4:00 | **Worker lifecycle:** persist the tab_ref map, focus start and queue on every change; rehydrate on wake; reconcile focus time capped at the idle threshold. | §13, §27 | Kill the worker mid-focus → no lost or doubled time |
| D-4 | 4:00–5:30 | **The Hollow:** editable built-in categories (banking and payments, health portals, personal email, password managers, sign-in/auth paths and identity providers, `chrome://`, `file://`, extension pages); user exclusions by suffix match; incognito guard; pause; strip query strings and fragments; title redaction (emails, long digit runs, token-like strings ≥ 24 chars); full URLs stored only locally by tab_ref; Hollow counter. Unit tests. | §9 | Bank site + `/login` → zero events, counter 2 |
| D-5 | 5:30–6:30 | **Queue + sync:** bounded queue (5,000, oldest dropped first); flush every 10 s while awake and on Grove open; offline retry with the **same `event_id`s and original timestamps**; events removed from the queue only after a 2xx response; `GET_SEND_PREVIEW`. | §9, §12 step 4, §27 | Wi-Fi off/on → batch arrives late with correct timestamps; a forced resend shows `duplicates > 0` and no extra rows |
| D-6 | 6:30–8:30 | **Sign-in:** `launchWebAuthFlow` + PKCE against Entra; token in `chrome.storage.session`; silent renew; “Sign in again” state; sign-out clears the session and queue, stops capture and opens the optional Microsoft sign-out URL. Entra timebox: 75 minutes (6:30–7:45); if it isn't working by then, switch to the fallback form posting to `/api/auth/login` within the same window (until 8:30). | §4 | Real Microsoft sign-in works, or the fallback login works |
| D-7 | 8:30–10:00 | **Bridge handlers** for every message in §4.3, typed from `contracts/bridge.types.ts`. `OPEN_TAB` uses the local URL store only; `CLOSE_TABS` only on request; snapshot capped at 60 tabs. Write a test page. | §13, §26 | Every message returns `{ok,data}` |
| — | 10:00–11:00 | **Rest** | | |
| D-8 | 11:00–12:00 | **Restore:** reopen the chosen refs (local URLs, else `fallback_urls`); request optional `tabGroups` the first time; restore into a named group; plain tabs if declined. The local URL store lives in `chrome.storage.local`, so it survives a browser restart. | §3.4, §10 P2 | 4 refs → group “Backend Authentication”; **also after quitting and reopening Chrome and signing in again** |
| D-9 | 12:00–13:30 | **Work Context capture:** context menu “Add page to Work Context”; Hollow check; `scripting.executeScript` returns the selection or visible `innerText` (≤ 12,000 chars, never inputs or cookies); friendly error on restricted pages; items stored locally. | §6, §13, §26, §27 | Works on a sample page; graceful failure on the Web Store |
| D-10 | 13:30–14:30 | **Privacy wiring:** pause, `EXCLUDE_DOMAIN`, exclusions synced with `PATCH /api/privacy`, `WIPE_LOCAL`. | §9 | Delete all → local storage empty |
| D-11 | 14:30–15:30 | **Bundle the real UI:** `scripts/bundle-grove.mjs` copies `apps/grove/dist/` into the extension as `grove.html` and falls back to the placeholder if missing. D never edits S's code. | §11, §13 | S's Grove runs inside the extension with real tabs |
| D-12 | 15:30–16:30 | Point the API adapter at P's deployed API; check CORS; fix differences inside D's adapter only; stay on mock if the API isn't live. | §12 | Rows appear in Tiger Data from D's browser |
| D-13 | 16:30–18:30 | **Demo browser:** clean profile; the 28 demo tabs browsed for real over the preceding hours so the timeline is genuine; 3 Hollow sites; SAMPLE pages captured into Work Context; `pnpm build:zip`. | §21 | Installable zip; demo profile ready |
| D-14 | 18:30–19:30 | `docs/privacy.md`: per-permission justification, what leaves the device, Limited Use statement, Web Store listing text explaining the `tabs` warning. | §9, §13 | Doc committed |
| D-15 | 19:30–21:30 | Extension test checklist (Hollow, incognito, offline, duplicate resend, worker restart, **Chrome restart → sign in → resume**, restricted pages); bug buffer. | §27 | Checklist green |

---

## 9. Lane P — Platform + memory

P builds the app, auth and everything stored about browsing. P tests with his own fixture events and his own fixture intent rows.

| ID | Hours | Task | § | Verify by |
|---|---|---|---|---|
| P-1 | 0:00–1:00 | FastAPI app factory, settings (all §11 env vars), CORS (extension origin only), RFC 7807 errors, `/health`, optional include of `app.engine.routes` **with the `get_user_id → current_user` override (§4.1)**, OpenTelemetry distro (§4.8). Deploy with `az webapp up`. Contract tests against the `contracts/` examples P drafted. | §11, §12 | `curl …/health` → 200 on Azure |
| P-2 | 1:00–2:15 | **P migrations** (`1xx_*.sql`) and `db/migrate.sh`: P's tables from §4.5 (including R's `tabs` columns and `saved_contexts.kind`); `browser_events` hypertable with 1-day chunks, columns `previous_tab_ref` and `is_tab_switch` (§4.6), unique key `(user_id, ts, event_id)`; indexes per §16. | §7, §16 | Hypertable listed; unique key present |
| P-3 | 2:15–3:15 | **Aggregates and policies:** `tab_attention_15m` (real-time, refresh every 1 min, counts `tab_switches`), `user_attention_daily` (built on the 15-minute view), `search_activity_1h`; compression after 7 days (`segmentby user_id`); retention 90 days. | §7, §16 | Fixture events → aggregate rows within 1 minute |
| P-4 | 3:15–4:15 | **Auth:** cached JWKS validation (signature, issuer, audience, expiry, ≤ 60 s skew); user_id per §4.1; `current_user()`; just-in-time `users` + `privacy_settings` rows; dev header; fallback `POST /api/auth/login` (Argon2id + HS256 JWT) behind a flag. | §4 | Valid → 200; tampered → 401; fallback works |
| P-5 | 4:15–5:00 | Repository layer: asyncpg pool, parameterized SQL only, `user_id` required in every function, `id AND user_id` lookups → 404, `extra="forbid"`, length caps (title ≤ 300, batch ≤ 500). | §4, §26 | `user_id` in body → 422 |
| P-6 | 5:00–6:15 | **`POST /api/events`:** **idempotent insert per §4.10** (batched `INSERT … ON CONFLICT (user_id, ts, event_id) DO NOTHING`, response `{accepted, duplicates}`); `is_tab_switch` from `previous_tab_ref` (§4.6); **sole owner of sessionization** — `browser_sessions` with the 30-minute gap rule and `session_id` stamped on every event (§4.11); `tabs` upsert of P's columns; limit 60/min. | §7, §12 step 4 | Contract batch → correct row counts; **the identical batch sent twice → `duplicates = n`, event count and `tab_attention_15m` unchanged** |
| P-7 | 6:15–7:00 | `GET /api/me`, `GET /api/sessions`, `GET /api/sessions/{id}` with attention summaries, tab switches, and intent switches derived at query time (§4.6; “unassigned” until R's clusters exist). | §7, §24 | Scripted round trip; FastAPI → Stack Overflow in one cluster counts as 0 intent switches |
| P-8 | 7:00–8:30 | **Timeline** `GET /projects/{id}/timeline?range=`: the §7 query (aggregate joined to `cluster_tabs` and `intent_branches` through C12) plus markers from `unresolved_questions` and `decisions` timestamps and intent-switch counts per bucket. Uses own fixture intent rows until R's tables have data. | §7, §17, §21 | Produces the 9:00 → 11:10 story |
| P-9 | 8:30–10:00 | **Saved contexts:** `save-context` stores the resume card snapshot sent by the UI plus stripped URLs; `kind` resume or references; list; `resume` returns the card with last active and time across sessions from the aggregates, and important tabs ranked by `cluster_tabs.importance`. | §3.4, §16, §24 | Save → list → resume shows “2 h 14 m across 3 sessions” on fixtures |
| — | 10:00–11:00 | **Rest** | | |
| P-10 | 11:00–12:00 | **Privacy:** `GET/PATCH /api/privacy` (exclusions, paused_until, retention, cloud_ai_enabled); nightly per-user retention job. | §9 | Exclusion persists; retention job deletes old events |
| P-11 | 12:00–13:00 | **Deletion:** `DELETE /api/projects/{id}` and `DELETE /api/me` remove rows from every §16 table (R's tables by name from §4.5, hypertable rows, embeddings, saved contexts) in one transaction, refresh aggregates over the affected range, and return counts. | §4, §26 | User A gone everywhere; user B untouched |
| P-12 | 13:00–14:00 | **Isolation suite** (`tests/test_isolation.py`): two users; B gets 404 on every one of A's resources across P's endpoints, and R's endpoints if mounted; events never cross users. | §4, §25 | Green locally and in CI |
| P-13 | 14:00–15:00 | **Hardening:** HTTPS-only and HSTS; `sslmode=require`; secrets only in App Service settings; no titles in logs; Application Insights dashboards for request latency, ingest volume and R's custom metrics. | §8, §26 | App Insights shows live requests and custom metrics; a request with only `X-Dev-User` returns 401 on the deployed API |
| P-14 | 15:00–16:00 | **CI/CD:** GitHub Actions deploys the API on push to `main` and runs migrations; `infrastructure/azure/deploy.sh` (app settings for both lanes' env vars). | §11, §25, §31 | Push → deployed in < 5 min |
| P-15 | 16:00–17:30 | **Demo seed** (`apps/demo-seed`): demo user, 2 days of attention history, past project “Backend Scaling — March 12” with insight + embedding (generated with Azure) + saved context. **SAMPLE** enterprise pages rendered from PRE-R2 at `/demo/*`. | §3.6, §6, §21 | Fresh demo account shows the firefly and the memory hit |
| P-16 | 17:30–19:00 | **Failure drills:** Tiger Data down (API 503 + `Retry-After`), restart during ingest, Azure down (confirm R's Seedling appears end to end), network drop. Written up in `docs/failure-drills.md`. | §27 | Each drill result documented |
| P-17 | 19:00–21:30 | Final deploy owner; bug buffer; P2 items from §12 of this file if time allows. | §31 | `main` deployed and tagged |

---

## 10. Dependency register (later dependencies that never block)

Each row is a dependency that exists at integration time. Until it is met, the consumer uses their stand-in, and the demo still works if it is never met.

| Consumer needs | From | Earliest real | Stand-in until then | If it's late or never arrives |
|---|---|---|---|---|
| D: API to send events to (C1) | P-6 | ~H6 | D's own mock API | Events stay queued locally (5,000 cap) and flush later |
| D: Entra registration; deployed API reachable from the extension | PRE-P3, PRE-P1, PRE-D2 | before event | Fallback login; mock API | Fallback login (cut order step 6) |
| D: Grove UI to bundle (C9) | S-6 | ~H10 | Placeholder `grove.html` | Demo the UI standalone with the mock bridge |
| S: AI endpoints (C3–C6) | R-8 to R-13 | H10 onward | S's own fixtures | That screen stays on fixture data |
| S: platform endpoints (C7) | P-7 to P-11 | H7 onward | S's own fixtures | Same |
| S: real bridge (C8) | D-7 | ~H10 | S's mock bridge | Mock bridge opens URLs in normal tabs |
| R: real attention and events (C11) | P-3, P-6 | ~H6 | R's fixtures (adapter catches a missing table) | Grove uses fixture dwell times |
| R: saved contexts for memory (C13) | P-9 | ~H10 | Fixture rows | Insights only on dormancy |
| R: app to mount into, and production auth | P-1, P-4 | ~H1 / ~H4 | `engine/standalone.py` with dev header | P's app runs without R's routes; if R must deploy standalone as a second App Service app, it imports P's `auth.py` module as a library (read-only) rather than writing its own |
| P: intent tables for timeline and intent switches (C12) | R-3, R-8 | ~H3 / ~H10 | P's fixture intent rows | Timeline shows one lane per project; intent switches shown as “unassigned”, never guessed |
| P: SAMPLE docs for `/demo` (C14) | PRE-R2 | before event | — | D and R test on local copies |
| P: R's metrics for dashboards | R-8 | ~H10 | — | Dashboard shows requests only |

---

## 11. Integration windows (each person swaps their own adapter; nobody waits)

| When | Swaps |
|---|---|
| **H6.5 smoke test (10 min, D + P only)** | D's extension sends real events to P's deployed `POST /api/events` (dev header or fallback login) → P confirms rows in `browser_events` on Tiger Cloud with correct `event_id`, timestamps, `previous_tab_ref` and `session_id`, then D forces a resend and P confirms `duplicates > 0` with no new rows. Proves extension networking, auth path, ingest, schema, timestamps and idempotency meet. If it fails, both go back to their mocks and fix their own adapter; nobody stops. |
| **H10** | D's API adapter → P's deployed API. R's routes mounted into P's app (merge only). S renders a real R grove JSON saved from R's standalone app. |
| **H15–H18** | D bundles S's `dist/` (D-11). S's adapters → live API (S-14). R's stats and contexts adapters → P's tables (R-15). P's intents adapter → R's real tables. |
| **H19.5** | Full demo run on the demo profile with seeded data; each person fixes bugs only in their own lane. |
| **H21.5** | **Feature freeze**, tag `demo-v1`. Then: P deploys, D builds the zip, S captures screenshots and the video, R does the final demo check. |

---

## 12. P2 items (only after all P0 and P1 work; each has one owner)

| P2 item (§10) | Owner |
|---|---|
| Restore into a named Chrome tab group | D (D-8 already includes it; drop if behind) |
| Canopy seasons; flower bloom animation | S |
| Handoff brief Markdown export (download button) | S (R's response already contains the text) |
| Managed identity from App Service to Azure OpenAI | P (App Service identity + role) and R (client switch, one line) |
| Postgres Row-Level Security with `SET LOCAL app.user_id` | P for P's tables, R for R's tables |
| Local Grove mode (`cloud_ai_enabled = false` → deterministic only) | P stores the flag, R honors it in grow, S adds the toggle |
| App Insights AI-quality tile (downgrade and fallback rate) | P |

---

## 13. Shared timeline at a glance

| Hours | R — Engine | S — UI + Pitch | D — Extension | P — Platform |
|---|---|---|---|---|
| 0–5 | Fixtures, normalize, R tables, embeddings, clustering | Fixtures + mocks, shell, D3 grove | Manifest + mock API, capture, lifecycle, Hollow | App + deploy, P tables, aggregates, auth, repo |
| 5–10 | Features, inference, validator, streamed grow | Forest elements, Tree Detail, grow orchestration + build | Queue/sync, **H6.5 smoke test with P**, sign-in, bridge | Ingest (idempotent), **H6.5 smoke test with D**, me/sessions, timeline, saved contexts |
| **10–11** | **Rest** | **Rest** | **Rest** | **Rest** |
| 11–16 | Seedling, claims/notes, Work Context, memory, prune | Timeline, Saved/Resume, Work Context, Privacy, memory/prune UI, wow animation | Restore, Work Context capture, privacy, bundle UI, live API | Privacy, deletion, isolation, hardening, CI/CD |
| 16–19.5 | Injection suite, real data, metrics + architecture doc | States, live adapters, Devpost, pitch | Demo profile, zip, privacy doc | Demo seed, failure drills |
| 19.5–21.5 | Latency, bugs, demo runs | Pitch, README, backup video | Test checklist, bugs | Final deploy, bugs, P2 |
| 21.5–24 | Freeze → technical Q&A prep (engine, Azure) | Rehearse ×5, submit Devpost | Q&A prep (privacy, permissions) | Q&A prep (Tiger Data) |

---

## 14. Traceability — every proposal section → tasks

| Proposal section | Covered by |
|---|---|
| §1 Core product (intent as the unit, signals table) | R-2, R-5–R-8 (signals: titles, opener, queries, dwell, order, notes, selected text) · D-2 (opener, queries) · P-3 (dwell) |
| §2 Difference by example; four certainty levels; wording by label | R-8 · S-2, S-5 (pills, wording) |
| §3.1 Intent reconstruction | R-5, R-7 |
| §3.2 Research memory | R-12 · P-9 (save trigger via C13) |
| §3.3 Unresolved question detection | R-6, R-7 · S-4 (mushrooms) |
| §3.4 Resume context + importance formula | R-6 · P-9 · S-8 · D-8 |
| §3.5 Intelligent pruning, never auto-close | R-13 · S-11 · D-7 (`CLOSE_TABS` on click only) · P-9 (`kind=references`) |
| §3.6 Long-term memory / “Have I researched…?” | R-12 · S-11 · P-15 |
| §4 Accounts, authorization, lifecycle, logout, deletion, timebox + fallback | P-4, P-5, P-11, P-12 · P-1 (single auth for R's routes, §4.1) · D-6 · R-1 (dev-only adapter), R-15 · S-13 · S-10 |
| §5 Forest visual language + interactions; D3 on SVG | S-3, S-4, S-5, S-12 · R-5 (sprouts), R-10 (resolve, confirm) |
| §6 Work Context Mode (ADP): context menu, upload, paste, tab metadata, `/demo`, output, handoff | D-9 · R-11 (analyze + upload endpoints) · S-9 · P-15 · PRE-R2 |
| §7 Tiger Data: hypertable, aggregates, hierarchical aggregate, compression, retention, vector, context switches, evolution query | P-2, P-3, P-6 (idempotent ingest, tab switches, sessions), P-7 + P-8 (intent switches at query time), P-8 · R-3 (vector, DiskANN), R-4, R-12 |
| §8 Azure: OpenAI, Entra, App Service, App Insights; failure behaviour per service | PRE-R1, R-7, R-9, R-14 · PRE-P3, P-4, D-6 · PRE-P1, P-1, P-14 · P-13, R-8 (metrics) |
| §9 The Hollow, what stays/leaves, exclusions, incognito, user controls, Web Store trust, send preview | D-4, D-5, D-10, D-14 · S-10 · P-10 · S-17 (Limited Use in README) |
| §10 P0 / P1 / P2 / post-hackathon; cut order | Lanes §6–§9 of this file · §12 P2 owners · §15 cut order |
| §11 Tech stack, env vars, local loop, fixed key, deploy, demo seed | D-1 · S-1 · R-1 · P-1, P-14, P-15 · PRE-D1 |
| §12 Architecture and 10-step flow | Step 1 D-6 · 2 D-2, D-4 · 3 D-5 · 4 P-6 · 5 P-3 · 6 S-6 orchestration → R-8 (+ D-7 snapshot) · 7 R-7 · 8 R-8 · 9 R-8 · 10 S-3, S-6, D-7 |
| §13 Extension: manifest, permissions, capture code, lifecycle, messages, no content scripts, install snapshot | D-1, D-2, D-3, D-7 |
| §14 AI pipeline steps 1–11; no multi-agent; prompt shape | 1 R-15/R-1 · 2 R-2 · 3 D-2, R-2 · 4 R-4 · 5 R-5 · 6 R-6 · 7 R-7 · 8 R-7 · 9 R-8 · 10 R-8 · 11 R-8 stream + S-6 |
| §15 Structured output schema | R-7, R-8 · S-5 renders it |
| §16 Data model, all tables, indexes, aggregates | P-2, P-3 · R-3 · §4.5 ownership |
| §17 UX: 7 screens, accessibility, outline view | S-2–S-13 |
| §18 Persona and secondary uses | S-16 |
| §19 Competitive differentiation and moat | S-15, S-16 |
| §20 Track alignment and 20-second pitches | S-16 (R reviews Azure, P reviews Tiger Data) |
| §21 Demo setup, narration, backup recording, Q&A cheat sheet | D-13 · P-15 · S-16, S-17, S-18 · R-17 |
| Contract examples (this plan) | PRE-C1, §5.1 · contract tests in R-1, S-1, D-2, D-7, P-1 |
| §22 Wow moment choreography and latency honesty | S-12, S-6 · R-8 (stream) |
| §23 24-hour plan, checkpoints, cut lines | This file §11 (incl. H6.5 smoke test), §13, §15 |
| §24 API endpoints and examples | §4.4 ownership · R-8, R-10–R-13 · P-4, P-6–P-11 |
| §25 Repository structure | §1 (with deviations in §16) · P-14 (workflow, deploy.sh) · `docs/` owners: R architecture, R metrics, D privacy, S demo-script, P failure-drills |
| §26 Security incl. prompt injection (6 layers) | Auth/isolation P-4, P-5, P-12 · SQL P-5 · validation P-5, R-11 · rate limits P-6, R-8 · secrets/HTTPS P-13 · sanitization S-2 · injection R-7, R-8, R-14, D-7, D-9 · least privilege D-1 · deletion P-11 |
| §27 Failure modes (all 10 rows) | Wrong clustering R-5, R-10, S-5 · low confidence R-8, S-5 · Azure down R-9 · Tiger down P-16, D-5, S-6 · network D-5 · inaccessible page D-9 · CSP-blocked D-9 · 2–3 tabs R-9, S-13 · shared tab R-5, S-4 · invalid output R-9 · worker restart D-3 |
| §28 Metrics and hallway test | R-16 · S-16 · P-13 (latency) |
| §29 What not to build | Respected: no history permission (D-1), no auto-close (D-7), no 3D (S-3), no multi-agent (R-7), no extra integrations |
| §30 Roadmap | S-15 (Devpost “what's next”) only; not built |
| §31 Final recommended project | Entire plan; deployment P-14, D-13 |
| §32 Fifteen questions | S-16 (Q&A cheat sheet) |

---

## 15. Cut order if behind (from §10 / §23)

1. All P2 items (§12 of this file).
2. Pruning (R-13, S-11 prune dialog).
3. Memory search, keeping one seeded firefly (R-12 search, S-11 search).
4. Work Context upload/paste, keeping context-menu capture on SAMPLE pages (R-11 `/upload` endpoint, S-9 upload).
5. Wow animation down to a fade and scale (S-12).
6. Entra sign-in down to the fallback login (D-6, P-4 already include it).

**Never cut:**
1. Real capture
2. The Hollow
3. Intent reconstruction
4. Evidence and provenance
5. The Living Grove
6. The Tiger Data timeline
7. Save → restart Chrome → Resume

---

## 16. Deliberate differences from the proposal (for independence and correctness)

| Proposal | This plan | Why |
|---|---|---|
| §25 `packages/shared` with a generated JSON Schema → TS types | No shared runtime package. A frozen `contracts/` folder of example payloads and `bridge.types.ts` (§5.1); each lane writes its own types and tests against those payloads | Same payloads for all four lanes, with no shared code to edit or wait on |
| §25 Grove UI inside `apps/extension/src/grove` | `apps/grove` as its own package, bundled by D-11 | S and D never touch the same `package.json` |
| §25 `apps/api/app/routers/…` | R's endpoints live in `apps/api/app/engine/routes.py`, auto-included | R and P never edit the same file |
| §25 single migration sequence | `1xx` (P) and `2xx` (R) files, no cross-lane foreign keys | Either lane's migrations can run first |
| §16 `users.id` from provisioning | Deterministic `uuid5` from tenant + object ID | R needs no lookup in P's table |
| §24 grow request without URLs | Adds `dup_key` and `search_query` | Exact duplicates (§3.5, §14 step 3) need URL information that §9 keeps on device |
| §7 `is_context_switch` computed at ingest | `previous_tab_ref` + `is_tab_switch` at ingest; intent switches derived at query time from clusters | At ingest most tabs have no cluster, so a semantic flag would be wrong |
| §7 `PRIMARY KEY (user_id, ts, event_id)` with a server default `event_id` | `event_id` generated by the client | Makes retries idempotent |
| §16 `analysis_runs` hypertable + an `analysis_quality_daily` aggregate | `analysis_runs` as a normal table; quality trends in Application Insights | Less database work for R; the Tiger Data story already rests on `browser_events` and its aggregates |
| §24 one Work Context endpoint | `/work-context/analyze` (JSON) and `/work-context/upload` (multipart) | Avoids one endpoint accepting two body types |
| §13 "only the worker makes API calls" | The Grove page calls the API itself with a token from `GET_TOKEN`, held in memory only | S owns the grow orchestration and streaming (S-6) without D proxying every request |

---

## 17. Definition of done

- [ ] Extension zip installs on a clean profile and captures real tabs
- [ ] Hollow sites and incognito produce zero events
- [ ] Grove grows from real tabs on the deployed API in ≤ 5 s, with trees streaming in
- [ ] Every claim shows provenance; roots show its evidence; low confidence sits in fog
- [ ] Timeline renders from Tiger Data aggregates with question/decision markers; same-cluster tab hops are not counted as intent switches
- [ ] Save → close tabs → **quit and reopen Chrome → sign in** → Resume restores only the important tabs
- [ ] The identical event batch sent twice leaves event counts and attention aggregates unchanged
- [ ] H6.5 smoke test passed: a real extension event lands in Tiger Data through the deployed API
- [ ] Work Context shows a decision with a verified quote and a blocker
- [ ] “Have I researched…?” finds the seeded March 12 work
- [ ] Isolation test green; delete-all leaves zero rows in every table
- [ ] Azure-down drill shows the Seedling fallback end to end
- [ ] Metrics in `docs/metrics.md`; backup video recorded; Devpost submitted; pitch under 3:00
