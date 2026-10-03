# Build Tasks — 24-hour execution plan

Current state and plan. Requirements live in [SPEC.md](SPEC.md); rules in [CLAUDE.md](CLAUDE.md); history in [changelog.md](changelog.md).

Last updated: 2026-10-03 · Team: Roopesh, Shriya, Deep, Pruthvi

## Status Legend

- [ ] Not started
- [~] In progress
- [x] Completed
- [!] Blocked

## Current Phase

**Pre-event.** Documentation only. No scaffold, no application code, no commits. Phase 0 has not started.

Test status: no tests exist.

```
CONTRACT FIRST → PARALLEL DEVELOPMENT → INTEGRATION → TESTING → DEMO → SUBMISSION
```

## Decisions needed in Phase 0

These are open conflicts or gaps. Do not resolve them silently; decide as a team in the first hour and record the outcome in changelog.md.

| # | Question | Default until decided |
|---|---|---|
| Q1 | **Grove UI owner.** The ownership brief assigns the D3 grove to nobody (Roopesh is excluded from it). | Shriya, because her resume work lives in the same page and she already consumes Grove JSON |
| Q2 | **Grove JSON shape.** The brief shows `{ "projects": [...] }`; SPEC §10.1 shows `{ run_id, hollow_count, trees, fog, meadow, degraded }`. | SPEC §10.1 |
| Q3 | **Event type field name.** The brief and the DB column use `event_type`; the SPEC §10.1 request example uses `type`. | `event_type` everywhere |
| Q4 | **Intent output shape.** The brief shows a flat object (`goal` and `direction` as strings, one `evidence` list); SPEC §7.4 has per-claim evidence, provenance and confidence. | SPEC §7.4 |
| Q5 | **Timeline and private accounts.** Both are P0 in SPEC §3.1, and the timeline is "never cut" in SPEC §3.4. Neither is in the brief's P0 demo story or its never-cut list. | Kept as **P0\*** below: scheduled after the core story works, each with a fallback |
| Q6 | **How the grove page gets API data.** SPEC §5.4 says only the service worker calls the API, but its message list (`GET_SNAPSHOT`, `OPEN_TAB`, `CLOSE_TABS`, `RESTORE`, `SIGN_IN`) has no message for fetching the grove, timeline or saved contexts. | Add worker messages in contract C5 |
| Q7 | **Backend auth owner.** Not assigned in the brief. | Roopesh, so sign-in has one owner end to end |
| Q8 | **Git workflow.** Not defined anywhere. | One branch per owner, small PRs into `main`, no force-push |
| Q9 | **Schedule.** SPEC §15 is a solo plan (P0 by H14, freeze at H21.5). This file replaces it for the team. SPEC §15 has not been edited. | This file governs scheduling |

## Ownership

| Owner | Workstream | Owns (files) | Works independently using |
|---|---|---|---|
| **Roopesh** | Extension, capture, the Hollow, sign-in | `apps/extension/manifest.config.ts`, `apps/extension/src/background/**`, grove `routes/Privacy`, `apps/api/app/auth.py`, `routers/me` | Mocked API responses |
| **Deep** | Database, FastAPI, Tiger Data | `db/migrations/**`, `apps/api/app/{main.py,db/**,routers/{events,grove,projects,privacy}}`, `apps/demo-seed/**`, `infrastructure/**`, grove `routes/Timeline` | Fixture events and fixture IntentCluster output |
| **Pruthvi** | AI: grouping, intent, validation | `apps/api/app/engine/**`, `routers/{memory,work_context}`, Pydantic models behind `intent.schema.json` | Fixture JSON; no live database |
| **Shriya** | Grove UI, save/resume, demo, submission | `apps/extension/src/grove/**` (except `routes/Privacy`, `routes/Timeline`), `packages/shared/fixtures/**`, `docs/demo-script.md` | Fixture Grove JSON and mocked worker messages |

Do not edit files another person owns. If you need a change there, ask the owner or change the contract through the process in CLAUDE.md.

### Why the load is about equal

Each owner has core implementation, tests, debugging, verification and documentation. Rough effort for Phases 1–4:

| Owner | Core P0 work | Hardest part | Extra |
|---|---|---|---|
| Roopesh | Capture, focus tracking, Hollow, queue, message router, sign-in (client + token validation) | MV3 worker sleep/wake state; Entra PKCE inside a 75-minute timebox | Privacy panel (P1) |
| Deep | Migrations, repository layer, ingest, grove and resume endpoints, seed loader, deploy, timeline | Hypertable + continuous aggregates; per-user isolation; being the integration hub | Privacy and delete endpoints (P1) |
| Pruthvi | Normalize, embed, cluster, open-loop detection, structured inference, validator, fallback | Clustering quality; evidence and provenance validation | Work Context analysis, memory search, pruning (P1) |
| Shriya | Grove canvas, claims and detail drawer, save/resume UI | D3 layout driven by data | Demo path, script, video, submission (leads Phases 5–6) |

Shriya's feature scope is smaller than the others' in Phases 1–4 because she carries the repeatable demo path from Phase 1 and leads Phases 5–6, when everyone else only fixes demo blockers.

### Dependencies between people

All cross-person dependencies go through a frozen contract, never through another person's code.

| From → To | Contract |
|---|---|
| Roopesh → Deep | C1 BrowserEvent, C4 `POST /api/events` |
| Deep ↔ Pruthvi | C2 IntentCluster, C6 engine interface |
| Deep → Shriya | C3 Grove JSON, C4 save/resume endpoints |
| Roopesh ↔ Shriya | C5 worker messages |
| Roopesh → Deep, Pruthvi | `current_user()` dependency (tests override it) |

---

## Phase 0 — H0:00–1:00 · Architecture + contracts (all four)

Do not start broad implementation before the contracts are agreed.

### C1 · BrowserEvent schema
Owner: Roopesh (reviewer: Deep)
Priority: P0
Status: [ ]
Dependencies: Q3
Files/Module: `packages/shared/schema/browser-event.schema.json`
What: Freeze the event object and batch envelope sent to `POST /api/events`.
Why: It is the only link between the extension and the backend.
Expected: Fields `ts`, `event_type`, `tab_ref`, `domain`, `title`, `search_query`, `opener_tab_ref`, `active_ms` (SPEC §8.2, §10.1), with the event-type enum and length caps from SPEC §12.
Success Criteria:
- Schema committed and agreed by Roopesh and Deep.
- A fixture batch validates against it.
Test: Schema validation of the fixture batch on both sides.
Fallback: None; this must be agreed.

### C2 · IntentCluster schema
Owner: Pruthvi (reviewer: Deep)
Priority: P0
Status: [ ]
Dependencies: Q4
Files/Module: Pydantic models in `apps/api/app/engine/`, generated `packages/shared/schema/intent.schema.json`
What: Freeze the per-cluster model output (SPEC §7.4).
Why: Deep persists it and Shriya's Grove JSON is built from it.
Expected: Pydantic models that generate the JSON Schema; provenance enum `stated | sourced | inferred | hypothesis`.
Success Criteria:
- Schema generated from the models.
- One fixture IntentCluster validates.
Test: Model round-trip test on the fixture.
Fallback: None.

### C3 · Grove JSON schema
Owner: Deep (reviewer: Shriya)
Priority: P0
Status: [ ]
Dependencies: Q2, C2
Files/Module: `packages/shared/schema/grove.schema.json`
What: Freeze the response of `POST /api/grove/grow` and `GET /api/grove`.
Why: The grove UI is built against it from hour 1 using fixtures.
Expected: Shape per SPEC §10.1, including the `degraded` flag.
Success Criteria:
- Schema committed and agreed by Deep and Shriya.
- Fixture grove validates.
Test: Schema validation of the fixture grove.
Fallback: None.

### C4 · API endpoint contracts
Owner: Deep (reviewers: all)
Priority: P0
Status: [ ]
Dependencies: C1, C3
Files/Module: SPEC §10 is the baseline; request/response bodies missing there are written down in `packages/shared/schema/`
What: Freeze paths, methods and bodies for the P0 endpoints: events, grove grow/get, save-context, resume, me, timeline.
Why: SPEC §10.1 gives examples for only some endpoints.
Expected: A body definition for every P0 endpoint.
Success Criteria:
- Save-context and resume bodies defined.
- No P0 endpoint without a documented body.
Test: API tests assert against these shapes.
Fallback: None.

### C5 · Worker message contract
Owner: Roopesh (reviewer: Shriya)
Priority: P0
Status: [ ]
Dependencies: Q6
Files/Module: shared TypeScript types under `apps/extension/src/` (exact path chosen in Phase 0)
What: Freeze `chrome.runtime.sendMessage` request/response types between the grove page and the worker.
Why: The grove page never calls the API or holds the token (SPEC §5.4).
Expected: Types for `GET_SNAPSHOT`, `OPEN_TAB`, `CLOSE_TABS`, `RESTORE`, `SIGN_IN`, plus the data-fetch messages decided under Q6.
Success Criteria:
- Types committed.
- Shriya can mock every message.
Test: Type-check; a mock implementation used by grove tests.
Fallback: None.

### C6 · Engine interface
Owner: Pruthvi (reviewer: Deep)
Priority: P0
Status: [ ]
Dependencies: C2
Files/Module: `apps/api/app/engine/` public entry point
What: Agree the single function the grove router calls. PROPOSED, not in SPEC: plain data in (open tabs, events, attention stats, user notes, prior research), list of IntentCluster out; the engine does not import `app/db`.
Why: Lets Pruthvi test with fixtures and Deep build with fixture output.
Expected: A typed signature and one fixture input/output pair.
Success Criteria:
- Signature agreed.
- Deep has a fixture-returning stand-in.
Test: Engine fixture test; router test using the stand-in.
Fallback: None.

### C7 · Fixture set and demo scenario
Owner: Shriya (contributors: all)
Priority: P0
Status: [ ]
Dependencies: C1–C3
Files/Module: `packages/shared/fixtures/`
What: One coherent scenario as fixtures: event batch, open-tab snapshot, IntentCluster list, Grove JSON, saved context. Baseline scenario: "Backend Authentication" (SPEC §7.4, §10.1).
Why: Everyone develops and tests against the same data; it doubles as the seeded demo.
Expected: Fixture files that validate against C1–C3.
Success Criteria:
- All four owners can load the fixtures in their tests.
Test: Schema validation of every fixture.
Fallback: None.

### C8 · Scaffold and Git workflow
Owner: Roopesh (`apps/extension`, pnpm workspace), Deep (`apps/api`, `db/`)
Priority: P0
Status: [ ]
Dependencies: Q8
Files/Module: repository root, `.gitignore`
What: Monorepo scaffold (SPEC §14.2), `.gitignore` covering `.env` and build output, agreed branch workflow, first commit.
Why: Four people need non-overlapping directories from the first hour.
Expected: Extension loads unpacked with a blank `grove.html`; API starts with `/health`.
Success Criteria:
- Both apps start locally.
- Test, lint and type-check commands recorded in CLAUDE.md.
Test: One placeholder test runs in Vitest and one in Pytest.
Fallback: None.

---

## Phase 1–2 — H1:00–12:00 · Parallel implementation, then independent verification

P0 = must work for the demo. P0\* = P0 in SPEC, outside the core demo story (see Q5). Phase 2 (H7–12): each owner tests their own module; no large integration refactors.

### Roopesh

### R1 · Manifest and service worker shell
Owner: Roopesh
Priority: P0
Status: [ ]
Dependencies: C8
Files/Module: `manifest.config.ts`, `src/background/index.ts`
What: Manifest with the exact permission set and `"incognito": "not_allowed"`; listener registration; toolbar icon opens `grove.html`.
Why: Everything else in the extension hangs off it.
Expected: Extension loads with no permission beyond SPEC §5.1.
Success Criteria:
- Loads unpacked without errors.
- Fixed `key` gives a stable extension ID.
Test: Manifest assertion test (permissions list, incognito flag).
Fallback: None.

### R2 · Browser event capture
Owner: Roopesh
Priority: P0
Status: [ ]
Dependencies: C1
Files/Module: `src/background/capture.ts`
What: OPEN / FOCUS / BLUR / UPDATE / CLOSE / IDLE / ACTIVE events, `tab_ref` minting, opener tracking, search-query extraction, on-install snapshot of open tabs (SPEC §5.3–5.4).
Why: The whole product depends on these signals.
Expected: Normalized BrowserEvent objects.
Success Criteria:
- Each lifecycle event produces a schema-valid event.
- `tab_ref` is stable for a tab's life.
- Existing open tabs are captured on install.
Test: Unit tests for normalization, opener mapping and search-query parsing.
Fallback: Seeded fixture events (C7).

### R3 · Active-time tracking
Owner: Roopesh
Priority: P0
Status: [ ]
Dependencies: R2
Files/Module: `src/background/focus-tracker.ts`
What: `active_ms` accounting across tab switch, window blur and idle; state persisted to `chrome.storage` and rehydrated after worker sleep.
Why: Dwell time drives leaf size, importance and open-loop detection.
Expected: Correct `active_ms` on BLUR events.
Success Criteria:
- Idle and window blur stop the clock.
- Time survives a worker restart, capped at the idle threshold.
Test: Unit tests with a fake clock, including a simulated restart.
Fallback: Emit events with `active_ms` from focus/blur timestamps only.

### R4 · The Hollow
Owner: Roopesh
Priority: P0
Status: [ ]
Dependencies: R2
Files/Module: `src/background/hollow.ts`
What: Built-in exclusion categories, suffix-matched user domains, incognito guard, pause check, title redaction, query-string stripping (SPEC §6).
Why: Privacy filtering is never cut; a leak fails the project.
Expected: Excluded tabs produce no events; only a Hollow count is exposed.
Success Criteria:
- No event for an excluded, incognito or paused tab.
- Emails, long digit runs and token-like strings are redacted from titles.
- No full URL in any outgoing payload.
Test: Exclusion, redaction and URL-stripping unit tests; a payload test asserting no URL leaves.
Fallback: None; never cut.

### R5 · Local queue, URL store and batching
Owner: Roopesh
Priority: P0
Status: [ ]
Dependencies: R2, C4
Files/Module: `src/background/queue.ts`
What: Bounded queue (≤ 5,000, oldest dropped), local `tab_ref` → URL map, 10 s flush to `POST /api/events`, retry on reconnect with original timestamps.
Why: Capture must survive an offline or missing backend.
Expected: Batches of ≤ 500 schema-valid events.
Success Criteria:
- Works against a mocked API.
- Queue persists across worker sleep.
- Failed flush keeps events.
Test: Queue bound, flush and retry tests with a mocked fetch.
Fallback: Keep queuing locally; grove runs from fixtures.

### R6 · Worker message router
Owner: Roopesh
Priority: P0
Status: [ ]
Dependencies: C5
Files/Module: `src/background/index.ts`
What: Implement the C5 messages: snapshot, open/focus a tab by `tab_ref`, restore a list of tabs, close tabs on explicit request, and the API-proxy messages.
Why: It is the grove page's only route to tabs and to the API.
Expected: Every C5 message returns its typed response.
Success Criteria:
- A leaf click reopens the right URL from local storage.
- Tabs close only on an explicit message from a user click.
Test: Message handler unit tests with mocked `chrome.*`.
Fallback: None.

### R7 · Sign-in (client and token validation)
Owner: Roopesh
Priority: P0\*
Status: [ ]
Dependencies: Entra app registration; Q5, Q7
Files/Module: `src/background/auth.ts`, `apps/api/app/auth.py`, `routers/me`
What: Entra PKCE via `launchWebAuthFlow`, token in `chrome.storage.session`, JWKS validation, `current_user()`, `GET /api/me` provisioning (SPEC §11).
Why: Every query is scoped by a token-derived user.
Expected: A signed-in user whose requests resolve to a `users.id`.
Success Criteria:
- Invalid or expired token returns 401.
- `user_id` never read from a request body.
Test: Token validation tests (bad signature, wrong audience, expired).
Fallback: 75-minute timebox, then the SPEC §11.1 fallback login (Argon2id + backend JWT).

### Deep

### D1 · API scaffold and early deploy
Owner: Deep
Priority: P0
Status: [ ]
Dependencies: C8; Azure App Service
Files/Module: `apps/api/app/main.py`, `infrastructure/azure/deploy.sh`
What: App factory, CORS for the extension origin only, `/health`, first deploy.
Why: Deploy early, not at the end (SPEC §15).
Expected: A reachable HTTPS `/health`.
Success Criteria:
- `/health` returns 200 locally and deployed.
Test: Health endpoint test.
Fallback: Run the API locally for the demo.

### D2 · Schema and migrations
Owner: Deep
Priority: P0
Status: [ ]
Dependencies: Tiger Cloud service; C1, C2
Files/Module: `db/migrations/001_core.sql … 004_vector.sql`
What: All SPEC §8 tables, `browser_events` hypertable, `tab_attention_15m` and `user_attention_daily`, compression and retention policies, `memory_embeddings`.
Why: Persistence and the time-series story depend on it.
Expected: A database initialized from scratch by running the migrations.
Success Criteria:
- Migrations apply cleanly on an empty database.
- Inserted events appear in `tab_attention_15m`.
Test: Migration smoke test; aggregate query test.
Fallback: Skip compression, retention and DiskANN index; keep hypertable and one aggregate.

### D3 · Repository layer
Owner: Deep
Priority: P0
Status: [ ]
Dependencies: D2
Files/Module: `apps/api/app/db/repo.py`
What: Parameterized asyncpg functions; `user_id` is the required first argument of every function; lookups filter `id AND user_id`.
Why: Data isolation is enforced here.
Expected: Functions to store and read events, tabs, projects, clusters, claims and saved contexts.
Success Criteria:
- No string-built SQL.
- Cross-user lookup returns nothing (API maps to 404).
Test: Repository tests; two-user isolation test.
Fallback: None.

### D4 · Event ingestion
Owner: Deep
Priority: P0
Status: [ ]
Dependencies: C1, D3
Files/Module: `apps/api/app/routers/events`
What: `POST /api/events` with Pydantic validation (`extra="forbid"`), COPY insert, `is_context_switch` at ingest.
Why: First hop of the end-to-end story.
Expected: `202 { accepted, dropped }`.
Success Criteria:
- Fixture batch persists.
- A body containing `user_id` returns 422.
- Batch over 500 is rejected.
Test: API tests for valid, invalid and oversized batches.
Fallback: Seed events directly with D7.

### D5 · Grove endpoints
Owner: Deep
Priority: P0
Status: [ ]
Dependencies: C3, C6, D3
Files/Module: `apps/api/app/routers/grove`
What: `POST /api/grove/grow` calls the engine (fixture stand-in first), persists results in one transaction, assembles Grove JSON; `GET /api/grove` returns the last grove.
Why: The stable contract the UI renders.
Expected: Schema-valid Grove JSON.
Success Criteria:
- Works with fixture engine output before the real engine exists.
- `degraded: true` passes through when the engine falls back.
Test: API tests validating the response against C3.
Fallback: Serve the fixture grove.

### D6 · Save and resume endpoints
Owner: Deep
Priority: P0
Status: [ ]
Dependencies: C4, D3
Files/Module: `apps/api/app/routers/projects`
What: `POST /api/projects/{id}/save-context`, `POST /api/contexts/{id}/resume` storing and returning the resume snapshot and important tab list.
Why: Resume closes the demo story.
Expected: A saved context that can be read back.
Success Criteria:
- Saved snapshot round-trips.
- Another user's context returns 404.
Test: API tests for save, resume and cross-user access.
Fallback: Shriya's UI resumes from a locally stored snapshot.

### D7 · Seed loader
Owner: Deep
Priority: P0
Status: [ ]
Dependencies: C7, D2
Files/Module: `apps/demo-seed/`
What: Script that loads the C7 fixtures into the database for a given user, repeatably.
Why: The demo must be reproducible if live data fails.
Expected: A populated grove after one command.
Success Criteria:
- Running it twice does not duplicate data.
Test: Seed-then-read test.
Fallback: `GET /api/grove` serves the fixture file.

### D8 · Research timeline
Owner: Deep
Priority: P0\*
Status: [ ]
Dependencies: D2; Q5
Files/Module: `routers/projects` (timeline), grove `routes/Timeline`
What: `GET /api/projects/{id}/timeline` from the aggregate (SPEC §8.5) and the lanes screen.
Why: Shows Tiger Data doing real work.
Expected: Lanes per branch with minutes per bucket.
Success Criteria:
- Response matches SPEC §10.1.
- Lanes render from fixture and live data.
Test: Query test on seeded events; component test on fixture.
Fallback: Endpoint only, shown as a simple table.

### Pruthvi

### A1 · Normalization and source classification
Owner: Pruthvi
Priority: P0
Status: [ ]
Dependencies: C6
Files/Module: `apps/api/app/engine/cluster.py`
What: Strip site suffixes, lowercase, collapse whitespace; classify source type by domain list (SPEC §7 step 2).
Why: Clean input for embedding and evidence diversity.
Expected: Normalized title and one source type per tab.
Success Criteria:
- Deterministic output for the fixture tabs.
Test: Table-driven unit tests.
Fallback: None.

### A2 · Embeddings with cache
Owner: Pruthvi
Priority: P0
Status: [ ]
Dependencies: Azure OpenAI embedding deployment
Files/Module: `apps/api/app/engine/cluster.py`
What: Embed `"{title} | {domain} | {source_type}"`, cached by SHA-256.
Why: Semantic similarity for grouping.
Expected: 1536-d vectors; repeat calls cost nothing.
Success Criteria:
- Cache hit on a repeated string.
- Tests run without network using stored vectors.
Test: Cache test; fixture vectors for offline tests.
Fallback: Cluster on domain + opener + time only (SPEC §13).

### A3 · Affinity clustering
Owner: Pruthvi
Priority: P0
Status: [ ]
Dependencies: A1, A2
Files/Module: `apps/api/app/engine/cluster.py`
What: `0.65·cosine + 0.20·opener + 0.15·temporal`, agglomerative, average linkage, threshold 0.45; singletons to the meadow; search tabs join the cluster they opened (SPEC §7.1).
Why: Core grouping; never cut.
Expected: Clusters for the fixture snapshot.
Success Criteria:
- Fixture tabs group into the expected goals.
- 2–3 tabs do not force a cluster.
Test: Clustering fixture tests.
Fallback: Lower-quality grouping by domain + opener.

### A4 · Features and open-loop detection
Owner: Pruthvi
Priority: P0
Status: [ ]
Dependencies: A3
Files/Module: `apps/api/app/engine/openloops.py`
What: Query families (cosine ≥ 0.80), open-loop flags (≥ 3 rephrasings in 2 h, no later focus > 90 s), dwell share, revisits, staleness, tab importance score (SPEC §3.5).
Why: Open questions and next actions come from these flags.
Expected: Deterministic features per cluster.
Success Criteria:
- The fixture's repeated search is flagged.
- A resolved search is not flagged.
Test: Open-loop detection tests, positive and negative.
Fallback: Flag on repeated queries only.

### A5 · Intent inference
Owner: Pruthvi
Priority: P0
Status: [ ]
Dependencies: C2, A4; Azure OpenAI chat deployment
Files/Module: `apps/api/app/engine/infer.py`
What: One Structured Outputs call per cluster, in parallel, with the DATA-block prompt (SPEC §7.3) and short refs.
Why: The only step that needs a model.
Expected: Schema-valid IntentCluster per cluster.
Success Criteria:
- Goal, branches, direction, questions and next actions for the fixture.
- No more than 8 calls per run.
Test: Tests with a recorded model response; schema validation.
Fallback: A7.

### A6 · Validator
Owner: Pruthvi
Priority: P0
Status: [ ]
Dependencies: C2
Files/Module: `apps/api/app/engine/validate.py`
What: Drop unknown refs, verify quotes verbatim, enforce provenance rules, cap confidence, map short refs back to UUIDs (SPEC §2.3–2.5).
Why: Evidence and provenance are never cut.
Expected: Only backed claims survive at their stated level.
Success Criteria:
- `stated` without a real note is downgraded.
- `sourced` with a non-matching quote is downgraded.
- Confidence never exceeds the evidence cap.
Test: Evidence, quote, provenance and confidence-cap tests.
Fallback: None.

### A7 · Seedling fallback
Owner: Pruthvi
Priority: P0
Status: [ ]
Dependencies: A3
Files/Module: `apps/api/app/engine/`
What: On model failure or invalid output: one retry, then clusters labeled by top shared title terms, marked degraded (SPEC §13).
Why: The demo must not hard-fail when Azure is down.
Expected: A truthful, lower-detail result.
Success Criteria:
- Simulated Azure failure still returns clusters.
Test: Fallback test with a failing client.
Fallback: Fixture IntentCluster output.

### Shriya

### S1 · Grove page shell
Owner: Shriya
Priority: P0
Status: [ ]
Dependencies: C5, C8
Files/Module: `src/grove/App.tsx`, `routes/`
What: Routes, left rail, data loading through worker messages, with a fixture mode.
Why: Frame for every screen.
Expected: Navigable page running entirely on fixtures.
Success Criteria:
- Loads fixture Grove JSON with no backend.
Test: Render test in fixture mode.
Fallback: Single-screen page.

### S2 · Grove canvas
Owner: Shriya
Priority: P0
Status: [ ]
Dependencies: C3
Files/Module: `src/grove/viz/GroveCanvas.tsx`, `viz/layout.ts`
What: D3 on SVG: trees, branches, leaves, meadow; pan/zoom; trunk thickness from attention; leaf click sends `OPEN_TAB` (SPEC §9.1).
Why: The grove is the product's interface; never cut.
Expected: A forest rendered from Grove JSON.
Success Criteria:
- One tree per project in the fixture.
- Leaf click sends the right `tab_ref`.
- Text set with `.text()`, never `innerHTML`.
Test: Grove data rendering tests (element counts from fixture); click interaction test.
Fallback: Static layout without zoom.

### S3 · Claims and Tree Detail
Owner: Shriya
Priority: P0
Status: [ ]
Dependencies: S2
Files/Module: `src/grove/components/` (EvidenceDrawer, ProvenancePill), TreeDetail route
What: Mushrooms, stones (carved vs moss), fog; drawer with goal, direction, decisions, open questions, next actions; provenance pills; roots highlight evidence leaves. Wording derived from the provenance label.
Why: Open question, next action and evidence are the core of the demo.
Expected: Every claim shows its label and evidence.
Success Criteria:
- `inferred` renders as "appears to…"; `hypothesis` as "Maybe:" in fog.
- Selecting a claim highlights exactly its evidence leaves.
Test: Component tests for pill wording and evidence highlighting.
Fallback: Drawer only, no roots animation.

### S4 · Save and resume UI
Owner: Shriya
Priority: P0
Status: [ ]
Dependencies: C4, C5
Files/Module: Saved Groves route, resume card component
What: Save context, Saved Groves list, resume card, restore important tabs via `RESTORE`.
Why: Resume closes the demo story.
Expected: Save, close tabs, resume, important tabs reopen.
Success Criteria:
- Works against mocked endpoints and messages.
- Default restore excludes redundant and stale tabs.
Test: Resume card render test; restore interaction test.
Fallback: Resume from the fixture saved context.

### S5 · Repeatable demo path
Owner: Shriya
Priority: P0
Status: [ ]
Dependencies: C7
Files/Module: `packages/shared/fixtures/`, `docs/demo-script.md`
What: The ten-step demo flow written down and runnable from a clean state on fixtures by the end of Phase 2.
Why: Do not discover in the last hour that the demo cannot be reproduced.
Expected: A dry run on fixtures at H12.
Success Criteria:
- Demo runs twice in a row from a clean profile.
Test: Scripted walkthrough checklist.
Fallback: None; never cut.

---

## Phase 3 — H12:00–16:00 · First integration

Connect Extension → API → AI → Grove by the simplest working path. No polish.

| Step | Owners | Done when |
|---|---|---|
| [ ] Extension posts real batches to the deployed API | Roopesh, Deep | Rows visible in `browser_events` |
| [ ] Grove router calls the real engine | Deep, Pruthvi | `POST /api/grove/grow` returns validated clusters for real tabs |
| [ ] Grove page renders live Grove JSON through worker messages | Shriya, Roopesh, Deep | Real tabs appear as a forest |
| [ ] Save and resume against the real API | Shriya, Deep | Saved context resumes and reopens tabs |

Contract mismatches found here are fixed through the contract-change process, not by ad-hoc patches.

## Phase 4 — H16:00–19:00 · End-to-end demo

Verify Capture → Filter → Store → Group → Infer → Persist → Render → Resume. Fix blockers only. Cut P2 if needed.

### E1 · End-to-end smoke test
Owner: Deep (support: all)
Priority: P0
Status: [ ]
Dependencies: Phase 3
Files/Module: `apps/api/tests/`
What: One test that posts the fixture events, grows a grove, saves and resumes.
Why: Guards the critical demo path during stabilization.
Expected: A single command that proves the path works.
Success Criteria:
- Passes against the seeded database.
Test: This is the test.
Fallback: Manual checklist run by Shriya.

- [ ] P0\* items (R7 sign-in, D8 timeline) integrated or their fallbacks active
- [ ] Hollow verified on the live path: a banking tab produces no event

## Phase 5 — H19:00–21:00 · Demo stabilization

Core functionality frozen. No architecture changes.

- [ ] Clean demo browser profile and seeded database (Shriya, Deep)
- [ ] Backup path: fixture-driven grove if live fails (Shriya)
- [ ] Screenshots and presentation (Shriya)
- [ ] Each owner: fix only demo-blocking bugs in their own module

## Phase 6 — H21:00–23:00 · Video + submission (Shriya leads)

### S6 · Demo video
Owner: Shriya
Priority: P0
Status: [ ]
Dependencies: Phase 5
Files/Module: `docs/demo-script.md`
What: Record and verify the final demo video from a clean starting state.
Why: Required deliverable.
Expected: A video showing the ten-step flow.
Success Criteria:
- Recorded before the submission deadline with margin.
- Plays back with audio.
Test: Watch the full recording once.
Fallback: Record the fixture-driven backup path.

### S7 · Submission
Owner: Shriya
Priority: P0
Status: [ ]
Dependencies: S6
Files/Module: submission form; README.MD screenshots
What: Project description, links, screenshots, paperwork, final checklist.
Why: Required deliverable.
Expected: Submitted entry with every required field.
Success Criteria:
- All links open from a signed-out browser.
- Required fields verified before submitting.
Test: Second person reviews the entry.
Fallback: None.

Everyone else: fix only demo-blocking issues.

## Phase 7 — H23:00–24:00 · Final verification

No new features. Only critical bug fixes, build verification, demo verification, submission verification.

---

## P1 — Important if time permits

Start only when P0 is stable. Each is expanded to the full task format when picked up.

| Task | Owner | Spec |
|---|---|---|
| [ ] Privacy panel: pause, excluded domains, retention, "what we send" preview | Roopesh (UI), Deep (`/api/privacy`) | §6.4 |
| [ ] Delete forest / delete account | Deep | §11.3 |
| [ ] Work Context capture: context menu + `executeScript` | Roopesh | §3.5 |
| [ ] Work Context analysis with quote verification | Pruthvi | §3.5 |
| [ ] Work Context screen and handoff brief | Shriya (if feasible) | §9.2 |
| [ ] Memory search and research-insight writes | Pruthvi | §3.5 |
| [ ] Pruning suggestions (API) and vines / prune dialog (UI) | Pruthvi, Shriya | §3.5 |
| [ ] User corrections: confirm / edit claim, move leaf, notes | Deep (API), Shriya (UI) | §10, §13 |
| [ ] Grow animation | Shriya | §9.3 |
| [ ] Rate limits and request caps | Deep | §12 |

## P2 — Polish / optional

Tab-group restore · canopy seasons · flower bloom · Markdown handoff export · managed identity · Row-Level Security · Local Grove mode · App Insights quality tile · outline view · `search_activity_1h` and `analysis_quality_daily` aggregates.

## Cut strategy

Behind schedule: cut P2 first, then reduce P1 scope. If P0 is unstable, stop all P1/P2 work.

Never cut:

- basic Chrome capture
- privacy filtering (the Hollow)
- database persistence
- core grouping
- basic intent reconstruction
- Grove visualization
- evidence and provenance
- basic next-action generation
- demo reproducibility

A small working system beats a large incomplete one.

## Current Work

Nothing in progress.

## Completed

- [x] SPEC.md, README.MD (2026-10-03)
- [x] CLAUDE.md, buildtask.md, changelog.md (2026-10-03)
- [x] Four-owner plan and contract list (2026-10-03)

## Blocked

None. Q1–Q9 above will block Phase 1 if not decided in Phase 0.

## Next Recommended Tasks

1. Confirm Q1–Q9, starting with Q1 (Grove UI owner) and Q7 (backend auth owner).
2. Confirm external setup: Azure OpenAI deployments, Tiger Cloud service, Entra app registration, App Service.
3. Run Phase 0: C1–C8.

---

# Project Definition of Success

The project succeeds if a judge can understand and experience the core idea within a few minutes.

Minimum successful flow:

1. User has several related browser tabs.
2. Extension captures their activity.
3. Sensitive information is filtered locally.
4. Related tabs are grouped.
5. System identifies the user's likely goal.
6. Research paths are shown.
7. A decision or open question is shown with evidence.
8. System suggests a reasonable next action based on the detected open loop.
9. Grove visually represents the context.
10. User can save and resume the context.
11. Demo is reproducible.
12. Final video and submission are complete.

Technical success:

- Core system works end to end.
- No critical privacy leak.
- No secrets committed.
- Core API contracts remain stable.
- Tests exist for the major modules.
- Build succeeds.
- Demo can be reproduced from seed data if live data fails.
