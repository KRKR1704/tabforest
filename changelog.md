# Changelog

Chronological record of what actually changed. Newest first. This is history, not a specification: intended behavior lives in [SPEC.md](SPEC.md).

Entry rules: record every meaningful implementation change (not tiny typos); be specific ("Added POST /api/events ingestion endpoint and validated event payloads with Pydantic", not "Updated backend"); no large code blocks; omit empty headings.

Headings per entry: Added · Changed · Fixed · Removed · Tests · Verification · Notes.

## [2026-10-03] — R-4: embedding cache in memory_embeddings (R)

### Added

- `apps/api/app/engine/embeddings.py`:
  - `tab_embedding_text()` = `"{title_clean} | {domain} | {source_type}"` (document types mapped with `leaf_source_type`, capped at 1,000 chars); `content_hash()` = SHA-256 hex of the exact UTF-8 string.
  - `embed_texts(user_id, kind, items, pool)`: dedupes identical texts, one cache lookup (`WHERE user_id = $1 AND content_hash = ANY($2)`), misses embedded in batches of ≤ 64 per Azure call, then one `INSERT … ON CONFLICT (user_id, content_hash) DO NOTHING` (safe for concurrent grows). Nothing is written until every batch succeeded. Azure errors propagate. Vectors returned as numpy `float32`.
  - Without a pool, or when `memory_embeddings` is missing, an in-process LRU cache (4,096 entries) is used with one warning.
  - `embed_tabs()` (`kind='tab'`, `source_id = tab_ref`) also sets P's `tabs.embedding_hash` with UPDATE only (never INSERT); skipped with one debug log if the table or column is missing. `embed_queries()` (`kind='query'`) for R-6 query families.
  - `EmbedStats` per call: `texts_requested`, `unique_texts`, `cache_hits`, `api_calls`, `inserted`, `store`, `tabs_hash_updated`.

### Tests

- `engine/tests/test_embeddings.py` (9, no network): dedupe, 150 texts → 3 calls (64/64/22), cache hit → 0 calls, a failed second batch writes nothing, LRU fallback without a pool (one warning), LRU fallback when the table is missing, no cache sharing between users, embedding text/hash, pgvector text round trip.
- `engine/tests/test_embeddings_live.py` (2, real Azure + Tiger Cloud, test user `…00bb`, rows deleted before and after): 28 demo tabs twice and the 3 search queries twice; a similarity preview of the demo groups.

### Verification

- Live run 1: 28 texts, 27 unique (tabs 01/02 are the same page), 1 API call, 27 inserted, 1072 ms. Run 2: 0 API calls, 27 cache hits, 116 ms; run 1 vs run 2 cosine ≥ 0.9999999. Queries: 1 call, then 0. 0 rows left for the test user.
- Similarity preview: Backend Authentication intra-group mean 0.478 vs 0.137 to Weeknight Dinner.
- `.venv\Scripts\python -m pytest app/engine/tests -q` from `apps/api`: 116 passed.

### Notes

- New dependency installed into `apps/api/.venv` for P's `pyproject.toml`: `numpy` (2.5.3).
- P's `tabs` table exists with `embedding_hash`; the test user has no rows there, so `tabs_hash_updated` was 0.

## [2026-10-03] — Lane S-3 D3 Living Grove, and grove realigned to R's contract (S)

### Added
- `apps/grove/src/viz/layout.ts`: pure grove geometry. d3-hierarchy (`hierarchy` + `cluster`) fans each tree's branches and leaves; trunk width from attention minutes and leaf length from dwell (sqrt scales); amber canopy when dormant 3+ days; sprouts at the left edge, then trees, the Wildflower Meadow and the Unclear fog patch; branch labels nudged apart so they never overlap.
- `apps/grove/src/viz/render.ts`: D3 draws into the `<svg>` (ground, three-blob canopy, trunk, branches, twigs, teardrop leaves, patches, fog banks, labels) and wires d3-zoom for wheel zoom and drag pan. All text set with `.text()`.
- `apps/grove/src/viz/GroveCanvas.tsx`: React owns the panel and the Zoom in / Zoom out / Reset view buttons; D3 owns the `<svg>`. `viz/palette.ts`: SVG colors mirroring the Tailwind tokens.
- `apps/grove/src/adapters/groveContract.ts`: converts the wire format of `contracts/grove.example.json` and `grove.stream.example.ndjson` (C3) into the app's grove types; meadow, fog and sprout tabs are named from the open-tab snapshot.

### Changed
- `apps/grove/src/mocks/mockData.ts`: the hand-written grove mock (3 trees, S-1 shape) is replaced by the real `contracts/grove.example.json` read through the adapter (4 trees, meadow, fog, sprout, firefly). R's contract drafts (PRE-C1) had made the old mock stale.
- `apps/grove/src/adapters/grove.ts`: live `getGrove`, `growGrove`, `analyzeProject` and stream lines now pass through the contract adapter instead of being cast to the internal types.
- `apps/grove/src/types/grove.ts`: optional fields added only (`ref_kind`, `display_text`, `stone_kind`, `fallen`, `days_since_active`, `canopy`, `fogged`, `shared_tab_refs`, `fog`, `banner_text`; wider `SourceType`; `age_minutes` now optional).
- `apps/grove/src/screens/CurrentGrove.tsx`: shows the canvas, with a Grove / Outline switch. The S-2 text list moved to `screens/GroveOutline.tsx`; it now shows the server's `display_text` wording and skips an empty direction.
- `apps/grove/src/components/EvidenceDrawer.tsx`: evidence sources are labelled from the contract's `ref_kind` (falls back to the short-ref prefix).
- `apps/grove/vite.config.ts`: dev server may read the repo-level `contracts/` folder.

### Tests
- `src/__tests__/groveContract.test.ts` (11): loads the real contract files; mock equals contract; tree identity, dormancy, leaves per branch, stones and mushrooms, claim provenance and evidence kinds, loose-tab titles from the snapshot, fireflies, the degraded example, the stream example.
- `src/__tests__/groveCanvas.test.tsx` (18): layout (4 trees, one leaf per tab, trunk vs attention, leaf vs dwell, amber rule and fallbacks, no overlap, sprouts at the edge, empty patches) and canvas (4 trees / meadow / fog / sprouts in the DOM, dormancy in words, open vs closed leaves, zoom in / out / reset / limit, hostile titles as text, redraw).
- Updated 3 existing tests for the new contract ids and the canvas being the default view; added 1 drawer test for `ref_kind`; the no-HTML source scan now also rejects D3 `.html(`.

### Verification
- `npm test`: 8 files, 89 tests passing. `npm run build`: passes with zero TypeScript errors.
- Manual (dev server, 1440×820): 4 trees with the Job Search canopy amber, sprout, meadow and fog visible; no overlapping labels (checked by bounding boxes); zoom buttons and drag pan work; no console errors.

### Notes
- `contracts/` was not edited. The mismatch was fixed in S's adapter (BUILD_TASKS.md §2 rule 3).
- Branch length uses branch status (active longer than explored): SPEC §9.1 maps it to recency, which the grove contract does not send.
- Not in S-3: mushrooms, stones, vines, fallen leaves, fireflies and fog density (S-4); click actions and Tree Detail (S-5). Fallen tabs are drawn as ordinary leaves for now.
- Still on the S-1 shape and to be realigned when their tasks start: the snapshot / bridge mock (`{tabs}` vs the contract's `{open_tabs}`, needed for S-6), timeline, saved contexts, work context, memory, prune, privacy.
- BUILD_TASKS.md: S-3 row ticked only.

## [2026-10-03] — R-3: R's migrations on Tiger Cloud (R)

### Added

- `db/migrations/200_engine_core.sql`: `projects`, `analysis_runs` (normal table, not a hypertable), `intent_clusters` (goal claim, direction, hypotheses, vines, query families, important tabs, fogged, run), `intent_branches`, `cluster_tabs` (PK `(cluster_id, tab_ref)`, importance, `assigned_by` ai/user, fallen), `decisions`, `unresolved_questions`, `suggested_actions`, `user_notes`, `research_insights`. Every table has `user_id uuid NOT NULL` and an index leading with `user_id`; no foreign keys to P's tables (`user_id`, `tab_ref`, `saved_context_id` are plain uuids); foreign keys only between R's tables (cascade where a child cannot outlive its parent). CHECK constraints on every enum-like column, on confidences (0..1), stated → `user_note_id`, sourced → `quote`, and resolved → `resolved_at`.
- `db/migrations/201_engine_memory.sql`: `memory_embeddings` (`kind` insight/context/tab/query, `vector(1536)`, `content_hash` SHA-256), DiskANN index (`vector_cosine_ops`, pgvectorscale) and `(user_id, kind)` btree; fails with a clear message if `vector`/`vectorscale` are missing (it does not create extensions).
- `db/migrations/README.md`: R's files (no README existed).
- `apps/api/app/engine/scripts/apply_r_migrations.py`: applies only `2xx_*.sql`, each file in one transaction, then prints R's tables (column counts), indexes and CHECK constraints, and the schema diff. Never drops anything.

### Tests

- `engine/tests/test_schema.py` (live, only with `DATABASE_URL`): every persisted contract field maps to an existing column, or is listed as DERIVED or held in P's tables (mapping table printed with `-s`); in ONE rolled-back transaction: the Backend Authentication tree round-trips unchanged (project, cluster, 3 branches, 10 cluster_tabs, carved + mossy stones, the mushroom, the next action, the user note), 51 vectors with the known one nearest under a `user_id` filter (EXPLAIN printed), bad provenance and bad status rejected by CHECK, per-user delete across all R tables leaves 0 rows; 0 rows for the test user after rollback.

### Verification

- `apply_r_migrations.py` run twice: first run 316 schema items added; second run "0 added, 0 removed".
- `.venv\Scripts\python -m pytest app/engine/tests -q` from `apps/api`: 105 passed, both schema tests ran against Tiger Cloud.
- Secret check before starting: commit `328d7a8` adds only `apps/api/.env.example` with empty values, placeholders and public identifiers; no other commit adds a key or a postgres URL with a password; `apps/api/.env` was never committed.

### Notes

- `memory_embeddings` uses `UNIQUE (user_id, content_hash)` instead of a global `UNIQUE (content_hash)`: a global key would stop a second user from caching the same tab string and would reveal, through the conflict, that another user embedded it.
- Work Context results reuse the claim tables: `decisions`/`unresolved_questions`/`suggested_actions` have `quote`, `source`, `source_timestamp` (+ `speaker` on decisions); blockers are `unresolved_questions.kind = 'blocker'`; owners are `suggested_actions.kind = 'ownership'` with `owner` and `task`; `intent_clusters.origin` and `goal_quote/source/source_timestamp` cover the Work Context goal. Document text is never stored; the full response is kept in `analysis_runs.response`.
- Ids are plain uuids; the API adds the contract prefixes (`p_`, `dec_`, `q_`, `a_`, `n_`, `g_`, `r_`). `user_note_id` is not a foreign key so notes survive cluster re-analysis.
- At 51 rows the planner uses the `(user_id, kind)` index or a seq scan plus sort, not DiskANN; that is expected at this size (proposal §16: exact scan over one user's rows).
- Leaf title, domain and source_type are not in R's tables: they come from P's `browser_events` and `tabs` (`tabs.title_norm`, `source_type`, `embedding_hash` are R-written columns that P's migration must create, §4.5).

## [2026-10-03] — R-2: title normalization, source types, search queries, duplicates (R)

### Added

- `apps/api/app/engine/normalize.py` (pure functions, no I/O):
  - `clean_title()` strips site suffixes and prefixes and `(n)` notification counters using tables (`TITLE_SUFFIXES` for any site, `DOMAIN_SUFFIXES` per site) plus a generic rule that removes a leading or trailing segment naming the site itself (e.g. `- FastAPI`, `GitHub - …`, `| Glassdoor`). Keeps casing; never empty (falls back to the domain). `norm_title()` gives the lowercased, punctuation-normalized form for embeddings.
  - `classify_source()` returns a `SourceType` (`docs`, `qa`, `code`, `discussion`, `video`, `search`, `work_tool`, `article`, `other`, plus Work Context types `ticket`, `pull_request`, `account_note`, `transcript`) from a suffix-matched domain table, refined by title for GitHub issues/PRs, Jira ticket keys, Teams transcripts and on-site search pages; `docs.*`/`developer.*` hosts default to `docs`. `official_source()` flags vendor/project docs for R-6. `leaf_source_type()` maps document types onto grove leaf types.
  - `parse_search_query()` returns the device-parsed query unchanged, else the query from Google, Bing or DuckDuckGo result titles (exact search-engine domains only, so `docs.google.com` is not a search page).
  - `duplicate_groups()`, `normalize_for_match()` (for quote verification: compare normalized forms on both sides, store the source text) and `normalize_tab()` → `NormalizedTab`.
- `apps/api/app/engine/scripts/check_db.py` (PRE-P2 database check from earlier, now committed).

### Tests

- `engine/tests/test_normalize.py` (63 tests): all 28 demo tabs classify to the grove contract's leaf `source_type` (sprout, meadow and fog tabs against an explicit list); the three search tabs recover their `search_query` from the title; 19 demo clean titles; 32 extra real-world titles covering every suffix rule and every `SourceType` (GitHub issue/repo/PR/gist, a Stack Overflow search page, YouTube `(3)` counter, Medium author and publication suffixes, a site-name-only title, a Spanish title, an empty title); demo duplicates are exactly tabs 01/02; `normalize_for_match` equates `we’ll`/`we'll`, also against the real 00:14:32 transcript cue.

### Verification

- `.venv\Scripts\python -m pytest app/engine/tests -q` from `apps/api`: 103 passed.

### Notes

- Grove leaves allow only the nine tab types, so R-5/R-8 should pass document types through `leaf_source_type()` (`pull_request` → `code`; `ticket`, `account_note`, `transcript` → `work_tool`).
## [2026-10-03] — D-3 worker lifecycle (D)

### Added

- Injectable `CaptureStateStore`: session-only Chrome tab refs, eligible IDs, focus state, previous ref and lastSeenAt under `tf_capture_session`; device-local URL pairs under `tf_capture_urls`. Local URLs survive a fresh browser session.
- Focus checkpoint/restore methods accumulate pre-persist time once and reconcile the interval since lastSeenAt with a 60-second cap. New timing starts at wake, preventing repeat reconciliation from double-counting.
- Seven lifecycle tests for repeated worker restarts, capped/idle intervals, disappeared/unknown tabs, storage separation, fresh browser sessions, synchronous listeners and serialized writes, including activation that wakes the worker.

### Changed

- Extended D-2's existing callback chain to await each state save. Listeners remain synchronously registered; callbacks arriving during hydration wait for it.
- Warm wake queries live tabs, drops disappeared session mappings and emits OPEN only for previously unmapped eligible tabs. Known tabs keep refs and do not get duplicate startup FOCUS. Cold startup retains D-2 snapshot behavior with fresh refs.

### Fixed

- Persist `openedRefs` in session state and suppress repeated OPEN emission from wake reconciliation, onCreated and overlapping snapshots. UPDATE remains unchanged. Remove entries on tab removal or disappearance during wake; older session records without this field start with an empty set.
- Added four regression cases in lifecycle.test.mjs covering duplicate wake OPEN, persisted suppression, UPDATE preservation and cleanup on removal/disappearance. Reproduced duplicate emissions before the fix.

### Verification

- Branch `feat/d-3-lifecycle`, required capture/focus files present; Node v20.20.2.
- From apps/extension, using `PATH="/opt/homebrew/opt/node@20/bin:$PATH"`: `pnpm test` passed 6 files / 41 tests; `pnpm typecheck` exited 0; `pnpm build` transformed 10 modules and completed in 124ms. Tests ran with loopback access for the existing mock API tests.
- With Deep's approval, changed only the snapshot test's conflicting assertions to require no additional startup events, 60 distinct tab refs and 60 unique event IDs, preserving its cap, ordering, skip and opener/UPDATE checks.
- Final review-fix verification: 6/6 test files and 45/45 tests pass (including 11 lifecycle tests); typecheck exits 0; build exits 0 (10 modules, 79ms), all using the Node 20 PATH prefix.
- All other test assertions unchanged in this follow-up. `git diff --check` passed; contracts, manifest and dependencies unchanged. No commit or push.

### Notes

- Save URL storage before session checkpoints; saves are serialized, but the two Chrome storage areas do not provide a cross-area transaction. lastSeenAt uses the callback/checkpoint timestamp so async write latency does not shift event timing.
- Retain local URLs when tabs disappear for later restore. If the stored focused tab disappeared, select the current eligible tab and emit FOCUS using the previous ref; otherwise preserve old focus for the waking activation's BLUR.
- No event queue or persisted events added. D-2 temporary console logging is unchanged; D-4/D-5 must sanitize/remove it as already recorded.
- Chrome was not run. Manual check: reload extension, inspect worker console and note a focused tab_ref, close worker DevTools, wait about 40 seconds for inactive status, switch tabs to wake it, reopen worker console and compare refs and BLUR active_ms. Keeping DevTools open can prevent worker sleep.

## [2026-10-03] — R-1: engine scaffold, adapters, fixtures and contract tests (R)

### Added

- `apps/api/app/engine/settings.py`: pydantic-settings over `apps/api/.env` for the five `AZURE_OPENAI_*` keys, optional `DATABASE_URL` and `AUTH_MODE`; other keys ignored; secrets are `SecretStr`.
- `engine/aoai.py`: async Azure OpenAI wrapper. `chat_structured()` (strict `json_schema` via the SDK's `parse`, returns the Pydantic model), `embed()` (batches of 64, input order kept), `ContentFilteredError` carrying the fired filters (`jailbreak`, `indirect_attack`, `other`) for prompt or completion, one retry with backoff on timeout/connection/429/5xx and never on `content_filter`.
- `engine/db.py`: optional asyncpg pool; `get_pool()` returns `None` without `DATABASE_URL`; the DSN is passed unchanged (`sslmode=require` kept).
- `engine/adapters/auth.py`: `get_user_id` accepts only `X-Dev-User: <uuid>`; otherwise 401 RFC 7807 problem JSON (`engine/problems.py`). No JWT/JWKS code (BUILD_TASKS.md §4.1).
- `engine/adapters/stats.py` (C11: events incl. `session_id`, `previous_tab_ref`; attention per tab_ref) and `engine/adapters/contexts.py` (C13: saved contexts), both on fixtures with a TODO(R-15) to switch to P's tables and fall back to fixtures.
- `engine/schemas/`: API models for R's contracts: grove (normal and degraded share one model), stream lines (clusters / tree / done), claims requests and responses, Work Context request and response, memory search, prune. Every model has `extra="forbid"`.
- `engine/routes.py` (`APIRouter(prefix="/api")`, dev-only `GET /api/_whoami`, 404 unless `AUTH_MODE=dev`; comment lists R's §4.4 endpoints) and `engine/standalone.py` (`GET /health` → `{"status":"ok","lane":"engine"}`, logs a dev-auth-only warning at startup).
- Fixtures: `events_2h.json` (134 events, 8 sessions, from `scripts/gen_events.py`, seed 20261004), `user_notes.json` (the note cited by `grove.example.json`), and loaders in `engine/fixtures/__init__.py` for every fixture and `contracts/` file.

### Tests

- `apps/api/app/engine/tests/` (40 tests): every R contract round-trips through its model with no extra or missing fields, the stream file line by line, the 422 `user_id` example is rejected; auth (no header, bad UUID, valid UUID, hidden outside dev); `/health`; fixtures (all 28 tabs covered, ordered timestamps, unique event ids, `previous_tab_ref` on every FOCUS, notes match grove, attention equals leaf `dwell_min`, generator is deterministic); Azure client with a fake SDK (content filters, no retry on filter, one retry on 429/timeout, embed batching, secrets hidden in reprs); live Azure (`chat_structured` + `embed`, 1536-d) and live DB (`SELECT 1`, timescaledb/vector/vectorscale), each only when its setting is present.

### Verification

- `.venv\Scripts\python -m pytest app/engine/tests -q` from `apps/api`: 40 passed; the live Azure (1.31 s) and DB (0.20 s) tests ran.
- `uvicorn app.engine.standalone:app --port 8100`: `/health` 200; `/api/_whoami` without the header → 401 problem JSON; with `X-Dev-User` → 200 `{"user_id": ...}`.

### Notes

- `events_2h.json` reuses P's late-session batch from `contracts/events.example.json` verbatim (10:57:40–11:24:49) and adds the rest so each tab's `active_ms` total equals its leaf `dwell_min` and the 30-minute gap rule reproduces P's sessions `…004`–`…008` exactly. To give every open tab history it also holds older sessions (Job Search on 9/29 and 9/30, Weeknight Dinner on 10/3), so it spans more than two hours. It includes P's closed fourth search tab `…029`.
- `apps/api/pyproject.toml` (P's) does not exist yet; dependencies were installed into `apps/api/.venv` with `uv pip install` and must be added by P.
- Tests run with `python -m pytest` from `apps/api`; `app` is a namespace package until P adds `app/__init__.py`.

## [2026-10-03] — D-2 capture (D)

### Added

- Extension capture, pure injectable-clock focus tracker, URL normalization/hash/search helpers and a single console-only `emit(event)` sink. Toolbar behavior stays unchanged.
- Contract-shaped OPEN, UPDATE, FOCUS, BLUR, CLOSE, IDLE and ACTIVE events with client UUIDs, UTC timestamps, stable in-memory tab refs and private local URLs. Install/startup snapshots emit OPEN for up to 60 HTTP(S) tabs ordered by last access.
- Fake Chrome/fake-clock tests for strict keys against P's first_send example, tab/opener refs, unique event IDs, timing, snapshots, URL helpers and toolbar preservation. Reconstructed FastAPI URLs reproduce the snapshot fixture's duplicate SHA-256 exactly.

### Fixed

- Declared focusedWindow as number rather than the inferred -1 literal.
- Closing the currently focused tab consumes and emits its dwell in BLUR before CLOSE, preserves its ref for the next FOCUS and never emits a second BLUR. Regression tests cover both removal-first and activation-first callback orders.
- Initial focused HTTP(S) tab now emits FOCUS with null previous_tab_ref before any later BLUR; added a regression test.

### Verification

- Confirmed branch feat/d-2-capture, HEAD 328d7a8 and required package/open_tabs fixture. Node 20.20.2 used via PATH prefix.
- Reproduced missing startup FOCUS and lost close dwell with failing regression tests before applying fixes.
- `PATH="/opt/homebrew/opt/node@20/bin:$PATH" pnpm test`: 5 files, 34 tests passed. Existing mock-server tests require loopback access; initial sandbox run failed with listen EPERM, final permitted run passed.
- Same PATH prefix with `pnpm typecheck` and `pnpm build`: exit 0; Vite transformed 9 modules and built in 154ms.
- `git diff --check` passed. Contracts, manifest, preflight, mock API and dependency files unchanged. Chrome not run; manual console verification remains for Deep.

### Notes

- First FOCUS has previous_tab_ref null. IDLE/ACTIVE without a focused eligible tab emit nothing; locked maps to IDLE. Background-window activations do not count as user focus; window changes pause/resume/select timing without emitting events.
- Removal-first callbacks emit BLUR, CLOSE, then the later FOCUS; activation-first emits BLUR, FOCUS, CLOSE. Callback timestamps/order are preserved, with serialized async Chrome lookups/hashes. No event delivery queue, retries, storage, network calls, auth or bridge handlers.
- HTTP(S)-only eligibility also applies to live capture; pendingUrl is used only when url is absent. An active new-tab page starts timing when its HTTP URL becomes available. Missing titles are null; titles truncate at 300 Unicode code points. Snapshot ties preserve query order; missing lastAccessed is treated as zero.
- Query extraction uses exact canonical engine hosts (optional www); regional engine domains are not inferred. Tracking parameter removal is case-insensitive, remaining parameters sort by key, and repeated-key order is preserved. Fixture duplicate URLs were reconstructed, not recovered from the fixture, which has no URL fields.
- Closed tabs lose their Chrome-ID mapping while their local URL remains in memory; worker restarts lose all state until D-3. Callback failures log a generic warning without page details.
- `[tf-capture]` console output currently includes unredacted titles/search queries as explicitly requested for D-2. This temporary debug output MUST be removed or sanitized in D-4/D-5; the Hollow must wrap emit before anything is queued.
- No commit or push.

## [2026-10-03] — PRE-C1 draft: P's contracts on the shared demo scenario (P)

### Changed

- `contracts/events.example.json`, `timeline.example.json`, `sessions.example.json`, `saved-context.example.json`, `privacy.example.json` and `me.example.json`: replaced the initial placeholders with P's drafts for C1, C2, C7 and C10. They follow R's conventions (`examples[]` of `{name, request, response, introduces}`, `unknown_ids` for other users' IDs, R's claim objects, RFC 7807 with `instance`) and R's IDs: tabs from `demo_tabs.json`; projects, claims, notes and saved contexts from `grove.example.json` and `memory-search.example.json`.
- `events.example.json` keeps top-level `batch_request` / `batch_response` for D's mock API test. The batch is now the 45-event start of the late session and shows all seven event types.

### Verification

- Totals agree with R's files: each Backend Authentication tab's timeline total equals its leaf `dwell_min`; Backend Authentication is 134 min across 3 sessions (resume); GirlHacks Prep is 41 min and Weeknight Dinner 9 min (sessions); the March 12 context matches the firefly and memory search; "Save as references" covers R's semantic-redundant prune pair.
- D's `apps/extension/tests/mock-api.test.mjs` against the new file: 7 passed (vitest 3.2.7). The fixture batch now has 45 events, so a manual resend shows `accepted 45` / `duplicates 45` instead of 3.
- P's cross-file checks (58 passed) and a mutation check (20 of 20 deliberate breakages caught) run locally and are not committed.

### Notes

- Shapes that differ from the placeholders, for S's adapters before S-14: integer `active_ms` instead of minutes; timeline lanes per branch in 30-minute buckets (SPEC §8.5 re-buckets 15-minute data into uneven 20-minute buckets); saved tabs carry `fallback_url` and `excluded_reason` (R's prune kinds); `/api/me` adds `email` and `stats`; `hollow_categories` is not in the privacy API because the Hollow lives in the extension.
- Assumption for R: note `n_…007` ("Not using OAuth providers for v1") was written at 10:12:20; the timeline's decision marker uses that time.
- Closed tabs introduced: `…029` (a fourth refresh-token search, closed at 11:11:22) and `…030` (a GirlHacks registration page).

## [2026-10-03] — Lane S-2 App Shell

### Added
- `apps/grove/src/shell/`: `AppShell`, `LeftRail` (Current Grove, Timeline, Saved Groves, Work Context, Ask Memory, Privacy, plus the Hollow count from `GET_HOLLOW_COUNT`), `TopBar` (screen title, "Have I researched…?" box, open-question count, Grow grove button) and `navigation.ts`.
- `apps/grove/src/components/ProvenancePill.tsx`: stated / sourced / inferred / hypothesis, each with an icon and a text label; confidence shown to two decimals for inferred and hypothesis only.
- `apps/grove/src/components/EvidenceDrawer.tsx`: right-hand drawer with the claim, its pill, the verbatim quote for sourced claims, and its evidence list (tab refs named by title and domain; `q`/`n`/`d` refs labelled Search / Your note / Document). Closes on the button or Escape.
- `apps/grove/src/theme/provenance.ts` (provenance design tokens), `src/components/icons.tsx` (mushroom glyph), `src/lib/grove.ts` (`countOpenQuestions`).
- `apps/grove/src/screens/CurrentGrove.tsx`: plain text reading of each tree's goal, direction, decisions and open questions from the contract data, so the pill and drawer are usable until the D3 canvas (S-3) replaces it. `ScreenPlaceholder.tsx`: empty state for the five screens not built yet.

### Changed
- `apps/grove/src/App.tsx` is now the app shell. The S-1 contract inspector moved unchanged (imports only) to `src/dev/ContractInspector.tsx`; it opens at `#inspector` under `npm run dev` and is excluded from the production bundle.
- `apps/grove/src/index.css`: `.pill-provenance` restyled (bordered, square corners; previously unused); added a global `:focus-visible` outline token.

### Tests
- `src/__tests__/shell.test.tsx` (19): rail order, active item, navigation, Hollow count wording, top-bar count / Grow / search submit, `countOpenQuestions`, App navigation, memory question shown as text, drawer open and close, empty grove.
- `src/__tests__/components.test.tsx` (15): pill labels and confidence rules, drawer content, source labels, quote, empty evidence, close on button and Escape, hostile markup rendered as text, and a source scan asserting no `dangerouslySetInnerHTML` / `innerHTML` in `src/`.

### Verification
- `npm test`: 6 files, 59 tests passing (25 existing + 34 new).
- `npm run build`: passes with zero TypeScript errors.
- Manual: ran the dev server and checked Current Grove, the evidence drawer and screen switching in a browser; no console errors.

### Notes
- Grow grove is not wired: `onGrow` is connected in S-6 (grow orchestration). The button shows "Growing…" and is disabled while the store reports a stream in progress.
- The memory box navigates to Ask Memory and shows the question; the search itself is S-11.
- Claim wording ("appears to…", "Maybe:") is not applied here; that belongs to Tree Detail (S-5).
- BUILD_TASKS.md: S-2 row ticked only.
## [2026-10-03] — D-1 extension scaffold (D)

### Added

- Standalone `apps/extension/` pnpm package with Vite, CRXJS, strict TypeScript, Vitest and a pinned dependency lockfile. No root workspace or UI libraries.
- SPEC §5.1 manifest with fixed public key, exact permissions, incognito disabled and strict CSP; no host permissions or content scripts. Toolbar listener opens the built `grove.html` placeholder showing the runtime extension ID.
- Dependency-free mock API on loopback port 8001 using the events contract: health, 202 batch acceptance, in-memory event ID deduplication, 500-event cap, user_id rejection and configured-origin CORS.
- Manifest and mock-API tests plus setup/manual Chrome instructions in the extension README.

### Verification

- Node `v20.20.2` via the explicit Node 20 PATH prefix; branch `feat/d-1-extension-scaffold` unchanged.
- Sandbox `pnpm install` failed with ENOTFOUND. Deep completed installation with pnpm 10.34.6 and reported 81 packages added. Existing esbuild ignored-script warning required no approval or package upgrade: build worked as installed.
- `pnpm test`: 2 files, 8 tests passed with local socket access. Initial sandbox attempt hit listen EPERM; test startup now reports listen failures promptly and skips teardown when not listening.
- `pnpm typecheck` and `pnpm build`: exit 0. Printed and checked the built manifest: fixed key/derived ID, exact permissions/CSP, no host permissions/content scripts; grove and worker output files exist.
- Started `pnpm mock`; curl returned health 200, fixture batch 202 with accepted 3/duplicates 0, and resend 202 with accepted 0/duplicates 3. Stopped the server.
- `git diff --check` passed; `EXTENSION_KEY.md` and `preflight/` unchanged.

### Notes

- Commands from `apps/extension/`, each prefixed with `PATH="/opt/homebrew/opt/node@20/bin:$PATH"`: `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm dev`, `pnpm mock`. Dev server not run; production build verified.
- Chrome could not be run. Deep must load `apps/extension/dist`, verify ID `nldemblgfgcaolkpkajdbefjfnileeoi`, and click the toolbar action to check the placeholder and runtime ID. No capture, queue, Hollow or sign-in implementation. No commit or push.

## [2026-10-03] — PRE-C1 task D: snapshot and bridge contracts

### Changed

- Copied only `open_tabs` from R's read-only `apps/api/app/engine/fixtures/demo_tabs.json` into `contracts/snapshot.example.json`: same 28 tabs, refs, order and values, without `_about` or `snapshot_at`.
- Replaced `SnapshotPayload` with `{ open_tabs: TabSnapshotItem[] }` per Deep's decision; removed `captured_at`. All other existing exported names and fields remain unchanged.

### Added

- `BridgeRequest` discriminated union covering all 16 messages, `BridgeReplyMap`, and `BridgeReply<T>` helper.
- Proposed `GetUrlsData` (`urls: Record<string, string>`) and `AcknowledgementData` (`null`), mapped to the nine acknowledgement-only messages approved by Deep.

### Verification

- Throwaway Python checks passed: exactly 28 tabs, unique refs, all opener refs valid, one equal-dup_key pair, all parsed fields and order identical (serialized UTF-8 bytes equal), and source fixture bytes unchanged.
- Requested `npx -y typescript@5 tsc --noEmit --strict --target ES2020 contracts/bridge.types.ts` failed: sandbox DNS/cache access first, then npm could not determine the executable with network access. Equivalent `npx -y -p typescript@5 tsc --noEmit --strict --target ES2020 contracts/bridge.types.ts` passed.
- Throwaway TypeScript check importing the actual JSON passed with `satisfies SnapshotPayload`; also verified all 16 request/reply keys and rejected invalid request/reply examples. Temporary check removed after validation.
- Compared existing type declarations against HEAD: only the approved SnapshotPayload replacement changed. `git diff --check` passed.

### Notes

- Draft RESTORE fallback URLs, PAUSE null semantics, auth/token/count/preview/work-item shapes and string errors remain unchanged for team review. No API edits, other contract edits, commit or push.
## [2026-10-03] — PRE-C1 draft: R's remaining contracts + cross-contract check (R)

### Added

- All generated by `gen_contracts.py` (one source, LF, snake_case). Request/response files hold `examples[]` of `{name, request, response, introduces}`; `introduces` lists ids a response creates.
- `contracts/claims.example.json` (R-10): confirm the mossy stone (→ stated, carved, new `user_note_id`), edit a next action's text, dismiss the hypothesis, resolve the refresh-token mushroom (answer + `resolved_at`); assign tab 13 to Backend Authentication / Sessions and tab 19 to a new tree "Interview Practice" (`assigned_by: "user"`, `pinned: true`); `POST /api/notes` clearing the fog tab (stated goal claim + note); `POST /api/projects/{id}/analyze` returning the Backend Authentication tree unchanged; RFC 7807 404 (another user's claim) and 422 (`user_id` in body).
- `contracts/work-context.example.json` (R-11): `analyze` request with the Jira ticket, PR and customer note as pages and a verbatim transcript excerpt (00:07:58–00:20:05, 26 cues) as paste, all read from `sample_docs/`; the `upload` multipart field description (`files[]`, `items_json` holding the same items); the shared response (documents with `d_…` ids, goal, decision, blocker, owners, open question, three ranked next actions with `unblocks`, handoff brief) with 8 sourced items quoting EXPECTED.json verbatim and 1 inferred open question; a 413 error.
- `contracts/memory-search.example.json` (R-12): `session storage` → Backend Scaling, 2026-03-12, similarity 0.84, 100 min, stated conclusion, same past project and saved context as the grove firefly; `recipe` → `found: false`, "No related research found".
- `contracts/prune.example.json` (R-13): exact and semantic suggestions equal to the two vines, stale = the three fallen Job Search leaves, one distraction (tab 26, 9 s), and the four actions.
- `apps/api/app/engine/scripts/check_contracts.py`: the 25 grove checks plus 9 cross-contract checks (ids, provenance on every claim, no `user_id`/snake_case, claims semantics, Work Context quotes and EXPECTED match, prune vs vines, memory vs firefly, generator determinism). Takes an optional contracts directory so broken copies can be tested.

### Changed

- `contracts/README.md`: freeze line `Frozen at <FILL AT FREEZE>`, table of every §5.1 file with its drafter (plus R's two new grove files), the consumer-adapter rule, R's conventions, and how to regenerate.
- Generator tab table: the meadow news tab's dwell is 1.4 min (was 0.13) so only one meadow tab is a < 10 s distraction. No generated file changes (meadow tabs carry no dwell).

### Verification

- `check_contracts.py`: 34/34 PASS, exit code 0.
- Broke a copy of each contract file once (firefly similarity, `degraded`, stream `done` line, `user_id` in a claims request, a reworded transcript quote, memory similarity, a missing stale tab); each run exited 1 with the matching checks failing. `contracts/` hashes were unchanged afterwards.

### Notes

- Editing a claim makes it `stated` with a new note (proposal §2: a user correction is stated; stated needs a real `user_note_id`).
- The Work Context response is for the `analyze` request, so it cites only those four items. Migration-doc quotes from EXPECTED.json appear only as upload example files.
- Work Context `documents[].source_type` uses new values `ticket`, `pull_request`, `account_note`, `transcript` (needed for the confidence cap's distinct source types).
- Page items use `domain: "tabforest-api.azurewebsites.net"` for P's `/demo/*` pages. This is a **placeholder** until PRE-P1 names the App Service.
- `snapshot.example.json` (D) should copy `open_tabs` from `apps/api/app/engine/fixtures/demo_tabs.json`.

## [2026-10-03] — PRE-C1 draft: grove generator, Seedling + stream contracts (R)

### Added

- `apps/api/app/engine/scripts/gen_contracts.py`: the single source for `demo_tabs.json` and all grove contracts. Before any edits it reproduced the reviewed `demo_tabs.json` and `grove.example.json` byte for byte (SHA-256 equal to backups; `git diff --no-index` empty). The files are untracked, so `git diff --stat` alone could not prove this.
- `contracts/grove.degraded.example.json`: Seedling mode (R-9, proposal §8/§27). Same 28 tabs and cluster membership; tree names are top shared title terms (`jwt · refresh · fastapi`, `girlhacks · mlh · hackathon`, `engineer · software · tailspin`, `recipe · pan · lemon`); one "All tabs" branch per tree; each goal a hypothesis (0.45, "Maybe: tabs about …"); `fogged: true`; no stones, mushrooms, next actions, hypotheses list or fireflies; exact-duplicate vine kept (computed on device); `degraded: true`, `banner_text: "AI unavailable — showing groups only"`.
- `contracts/grove.stream.example.ndjson` (BUILD_TASKS.md §4.7): `clusters` line (deterministic names, tab_refs, attention, days, canopy, plus sprouts/meadow/fog; no claims) → 4 `tree` lines, smallest cluster first, each equal to its tree in `grove.example.json` → `done` with `degraded: false` and the firefly.

### Changed

- `contracts/grove.example.json`: GirlHacks Prep has a resolved mushroom "Which sponsor tracks should we submit to?" (inferred 0.70, 3 leaf refs, answer + `resolved_at`); both mushrooms now carry `status`, `answer`, `resolved_at`. New `fogged` on every tree and `banner_text: null` at the top so normal and Seedling groves share one shape. The sprout label is now the deterministic `ownership · rust · cli` (was "Learning Rust"), because sprouts appear in the `clusters` line before any model call.
- All generated files are written with LF line endings (`demo_tabs.json` differs from the reviewed file only in CRLF → LF).
- `check_grove_contract.py`: checks 1–7 run on both groves; new mode rules (degraded vs normal), mushroom status fields, six stream checks, and Seedling membership/label consistency with the stream (25 checks).

### Verification

- `check_grove_contract.py`: 25/25 PASS, exit code 0. Running the generator twice gives identical hashes; no CR bytes in any output.
- Mutation tests (temporary copies): resolved mushroom without answer, an inferred claim in Seedling mode, a dropped Seedling leaf, a blank stream line, an edited tree line, a cluster using the model-written name and a missing `done` line each fail the matching check. The missing-`done` case first crashed the script (`KeyError`); fixed to report FAIL.

## [2026-10-03] — PRE-C1 draft: `contracts/grove.example.json` + demo tab set (R)

### Added

- `apps/api/app/engine/fixtures/demo_tabs.json`: the 28-tab demo snapshot (BUILD_TASKS.md §4.2 fields, `open_tabs` envelope per proposal §24), snapshot time 2026-10-04T11:40:00Z, fixed tab_refs `00000000-0000-4000-8000-0000000000NN`, real SHA-256 `dup_key`s. Backend Authentication 01–10, GirlHacks Prep 11–15, Job Search 16–20 (opened 4–5 days ago), Weeknight Dinner 21–23, sprout 24–25, meadow 26–27, fog 28.
- `contracts/grove.example.json` (**draft, for R's review; not frozen**): full `POST /api/grove/grow` response. 4 trees, 1 sprout, 2 meadow tabs, 1 fog tab, 1 firefly (Backend Scaling, 2026-03-12, 0.84). Backend Authentication carries the §21 narration content: goal (inferred 0.82), JWT/OAuth 2.0/Sessions branches, direction (inferred 0.71), carved stated stone with `user_note_id`, mossy inferred stone, refresh-token mushroom (0.78, recurrence 4), next action that unblocks it, semantic + exact vines, Azure hypothesis (0.41). Job Search is amber, 4 days inactive. Tab 05 is shared by Backend Authentication and GirlHacks Prep.
- `apps/api/app/engine/scripts/check_grove_contract.py`: checks coverage of all 28 tabs, evidence resolution per tree, provenance rules, the confidence cap, display wording, shared tab / exact dup / unblocks / amber canopy, and snake_case keys.

### Verification

- `check_grove_contract.py`: 7/7 PASS, exit code 0.
- Mutation test (temporary copy, not committed): dropping the fog tab, a `t3` short ref, an inferred claim with one ref, confidence 0.99, a hypothesis without "Maybe:", a bogus `unblocks`, a camelCase key and a green job canopy each make the matching check fail.

### Notes

- Backend Authentication cannot hold all requested tabs in 10 (13 needed). Adjusted: Reddit dropped; "OAuth 2.0 overview" and "Azure auth docs" merged into one Microsoft Learn OAuth 2.0 auth-code-flow page (OAuth branch, shared tab, hypothesis evidence); 3 of the 4 refresh-token searches are open tabs, the 4th is only in history. The mushroom cites the 3 search tabs, the short-visit article and query family `qf_…` (4 rephrasings).
- Additions beyond the requested shape: per-tree `query_families[]` (so `ref_kind: query` refs resolve), `kind` on stones (`carved`/`mossy`) and mushrooms (`repeated_search`, from §15), `user_note_id`/`quote` on stones (§15), `reason` on next actions (§15).
- `source_type` adds `article` and `other` to the §14 list (docs, qa, code, discussion, video, search, work_tool); recipes, news, job boards and the grocery cart need them.
- §24's example uses `question` for mushroom text and `tab_ref` in evidence; this contract uses `text` and `{ref_kind, ref, why}` as requested.
- Allocation differs from §21 setup (job search 6, random 6); trees still match the narration ("four goals, a meadow, a patch of fog").
- `contracts/snapshot.example.json` is D's file (§5.1); D should copy `open_tabs` from `demo_tabs.json` so both match.

## [2026-10-03] — PRE-R2: SAMPLE enterprise documents (R)

### Added

- `apps/api/app/engine/fixtures/sample_docs/`: fictional Contoso/Fabrikam work artifacts for Work Context Mode: `jira-CAM-142.md`, `pr-418.md`, `teams-transcript.vtt` (51 cues, ~23 min, decision "we'll go with Functions" at 00:14:32, session-state question raised twice and unanswered), `migration-doc.md` (§1–§6, §4 Cutover and rollback, session storage TBD), `customer-note.md`, plus `EXPECTED.json` (answer key for R-11: goal, decision, blocker, owners, open question, three ranked next actions, 19 verbatim quotes) and `README.md`.
- `apps/api/app/engine/scripts/check_sample_docs.py`: checks banner, < 12,000 chars per file, WebVTT validity, decision cue, session-state question count, and that every EXPECTED quote is a verbatim substring of its file (and of the cue at its timestamp for the transcript).

### Verification

- `check_sample_docs.py` run with `apps/api/.venv` (Python 3.13.13): all checks PASS, exit code 0.

### Notes

- BUILD_TASKS.md PRE-R2 says "Markdown" and "password-manager share". The transcript is WebVTT instead (R-11 accepts VTT uploads) and the files live in the repo under R's folder; they contain no secrets.
- The WebVTT format requires `WEBVTT` on line 1, so the transcript's banner is in a `NOTE` block right after it; `EXPECTED.json` carries it as the `_banner` key.
- Proposal §6 shows "You → OAuth callback (inferred)". The Jira ticket explicitly assigns that work to You, so `EXPECTED.json` marks it **sourced**.
- Quotes use ASCII apostrophes (`we'll`); the proposal text uses a typographic one (`we’ll`). R-11 quote verification must match the source text, not the proposal.
- A fifth fictional person, Jordan Blake (Fabrikam IT lead), was added as the customer contact.

## [2026-10-03] — PRE-R1: Azure OpenAI resource, deployments and smoke test (R)

### Added

- Azure (subscription "Azure subscription 1"): registered the `Microsoft.CognitiveServices` provider; created resource group `tabforest-rg` (eastus2) and Azure OpenAI account `tabforest-aoai` (S0, custom domain, endpoint `https://tabforest-aoai.openai.azure.com/`).
- Deployment `chat`: `gpt-4.1-mini` version `2025-04-14`, GlobalStandard, capacity 50. Deployment `embed`: `text-embedding-3-small` version `1`, Standard, capacity 50. Region and versions taken from `az cognitiveservices model list -l eastus2`.
- `apps/api/.env` (git-ignored, not committed) with `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_CHAT_DEPLOYMENT=chat`, `AZURE_OPENAI_EMBED_DEPLOYMENT=embed`, `AZURE_OPENAI_API_VERSION=2024-10-21`; `apps/api/.env.example` with the same keys, empty.
- Root `.gitignore`: `.venv/`, `*.local.json` (per-developer settings files) and `__pycache__/`; `.env`, `.env.*` and `!.env.example` were already present.
- `apps/api/app/engine/scripts/smoke_aoai.py`: Test A (strict `json_schema` Structured Outputs, parsed with Pydantic), Test B (batched embeddings, 1536-d, cosine), Test C (Prompt Shields, report only). Exits non-zero if A or B fails.

### Fixed

- Root `.gitignore` (from `main`): the section header lines had no `#`, so git treated them as ignore patterns (a file named `Logs` or `Dependencies` was ignored). They are now comments. `.log` → `*.log` (it matched only a file literally named `.log`) and `.generated.` → `*.generated.*` (it sits under the "Generated files" header and most likely lost its asterisks in a Markdown copy). No other entries changed; no tracked file is newly ignored.

### Verification

- Smoke test run with a local venv (`apps/api/.venv`, Python 3.13.13; openai 3.24.0, pydantic 2.13.5, python-dotenv 1.2.4): A PASS (2014 ms, tab_refs t1–t3, confidence 0.95), B PASS (2 × 1536, cosine 0.7041), C blocked with HTTP 400 `content_filter`, `jailbreak: detected/filtered` under the default filter. Exit code 0.

### Notes

- `uv` is not installed on R's machine yet (PRE-ALL), so the smoke test ran from a plain venv rather than `uv run`. No `pyproject.toml` or requirements file was created (P owns project deps).
- Prompt Shields for indirect (document) attacks still need to be configured on the deployment's content filter in the portal (proposal §26). Test C hit the default user-prompt jailbreak shield because the title is sent in the user message.
- `AZURE_OPENAI_API_VERSION` is not in the proposal's env-var list (§11); it was added at R's request.

## [2026-10-03] — PRE-D2 networking preflight extension

### Added

- `apps/extension/preflight/`: dependency-free MV3 probe using PRE-D1's fixed public key, strict CSP and no permissions or content scripts. Toolbar opens a page with the runtime ID, an API base input, and separate page/worker `/health` fetch buttons.
- Text-only HTTP status/body or error results; worker logs and returns its result. HTTPS base validation rejects credentials, query strings and fragments.
- README with unpacked loading, ID comparison, page and worker DevTools screenshot steps, and CORS troubleshooting.

### Verification

- `node --check` passed for `preflight.js` and `background.js`.
- Inline Node assertions passed: manifest JSON and privacy invariants, public key and derived ID, toolbar target, displayed ID, async worker response, and mocked page/worker HTTP 200, HTTP 503, fetch failure and HTTPS rejection.
- `git diff --check` passed. Tests used mocks only; no Chrome or live API requests executed.

### Notes

- Deep must verify the extension ID in Chrome and capture both HTTP 200 results against P's deployed API with the fixed origin allowed in CORS. PRE-D2 live verification remains pending.
- Task 2 remains on hold; no contracts files edited. No commit or push.

## [2026-10-03] — Lane PRE-S1 Visual Design & Pitch Preparation

### Added
- `docs/moodboard.md`: Visual design specification detailing typography (Lora + Inter), HSL forest color palettes, and data-encoding rules for all 12 Living Grove elements (trees, branches, leaves, sprouts, mushrooms, carved/mossy stones, blooming flowers, redundant vines, fallen leaves, dynamic confidence fog, evidence roots, fireflies), plus accessibility and reduced-motion specifications.
- `devpost/submission-draft.md`: Devpost submission draft aligned to Azure AI and Tiger Data TimescaleDB tracks, detailing problem inspiration (Maya persona), feature breakdown, architecture layer overview, accomplishments, challenges, and roadmap.
- `docs/demo-script.md`: Comprehensive 28-tab live demo script and narrative timed to 2:45, including sequential tab definitions across 3 clusters, meadow, sprouts, and on-device Hollow sites, speaker cues, and judge Q&A cheat sheet.

### Verification
- Cross-checked 28 demo tabs sequence against `contracts/snapshot.example.json` and SPEC §4.2.
- Verified visual language mappings directly correspond to Tailwind design tokens and D3 visualization requirements.

## [2026-10-03] — Lane S-1 Grove Foundation & Contract Adapters

### Added
- `apps/grove/` standalone package initialized with React 18, TypeScript, Vite, Tailwind CSS, Zustand, and TanStack Query.
- `contracts/` frozen contract payloads: `events.example.json`, `snapshot.example.json`, `grove.example.json`, `grove.stream.example.ndjson`, `claims.example.json`, `timeline.example.json`, `saved-context.example.json`, `work-context.example.json`, `memory-search.example.json`, `prune.example.json`, `privacy.example.json`, `me.example.json`, `sessions.example.json`, `bridge.types.ts`.
- `apps/grove/src/types/` implementing exact data models matching SPEC §15 and contracts (grove, claims, memory, workContext, platform, bridge).
- `apps/grove/src/adapters/` implementing C3–C8 consumer connections (`grove.ts`, `memory.ts`, `workContext.ts`, `platform.ts`, `bridge.ts`) with `VITE_MOCK=1` mode and robust mock fallback.
- `apps/grove/src/store/` Zustand state stores (`useGroveStore.ts` for visualization/stream orchestration, `useBridgeStore.ts` for Chrome extension bridge state and authentication).
- `apps/grove/src/App.tsx` foundational interface featuring contract inspection, live mock bridge state, and NDJSON streaming simulation.
- `apps/grove/src/__tests__/` automated test suite with 25 unit tests across `contracts.test.ts`, `bridge.test.ts`, `adapters.test.ts`, and `store.test.ts`.

### Tests
- Contract schema validation tests for Grove, 28-tab snapshot, timeline buckets, resume card, work context, memory search, and sessions.
- Bridge adapter tests covering 16 message types (`GET_SNAPSHOT`, `OPEN_TAB`, `CLOSE_TABS`, `RESTORE`, `GET_URLS`, `SIGN_IN`, `SIGN_OUT`, `GET_AUTH_STATE`, `GET_TOKEN`, `PAUSE`, `EXCLUDE_DOMAIN`, `GET_HOLLOW_COUNT`, `GET_SEND_PREVIEW`, `GET_WORK_ITEMS`, `CLEAR_WORK_ITEMS`, `WIPE_LOCAL`).
- API adapter tests including live NDJSON stream line parsing (`clusters` → `tree` × n → `done`).
- Zustand store action and state transition tests.

### Verification
- `npm test`: 4 test files, 25 tests passing.
- `npm run build`: Static production bundle compiled into `dist/` with zero TypeScript errors.

## [2026-10-03] — PRE-D1 fixed extension key and stable ID

### Added

- `apps/extension/EXTENSION_KEY.md`: public DER key, derivation, extension ID `nldemblgfgcaolkpkajdbefjfnileeoi`, and extension origin. Generated the 2048-bit RSA private key outside the repo with mode 0600.
- Root `.gitignore`: PEM, environment files (except `.env.example`), node_modules, dist, and virtual environments.

### Verification

- `openssl rsa -check -noout`: RSA key ok. Confirmed private key path is outside the repo and permissions are 0600.
- Node assertions: documented public key matches the private key's public DER; modulus is 2048 bits; independently derived ID and origin match; `.gitignore` has the exact requested lines.
- `git check-ignore --no-index`: requested sensitive/generated paths ignored, `.env.example` not ignored. `git diff --check` passed.

### Notes

- Chrome extension ID match is not yet verified; requires loading the Task 3 preflight extension. No commit or push.

## [2026-10-03] — Docs aligned with BUILD_TASKS.md plan v3

### Changed

- buildtask.md is superseded by BUILD_TASKS.md (plan v3), which is now frozen; only Roopesh (R) changes it, by team decision. Entries below describe the earlier plan and its ownership, which no longer applies.
- CLAUDE.md: ownership replaced with the BUILD_TASKS.md §1 lanes (Roopesh = R engine, Shriya = S Grove UI + pitch, Deep = D extension, Pruthvi = P platform); contracts now point to BUILD_TASKS.md §3 and the frozen `contracts/` folder (no `packages/shared`, no schema generation); grove page gets the token with `GET_TOKEN` and keeps it in memory only; H10 requires a changelog entry instead of a build-task edit; H13 allows `AUTH_MODE=dev` only under the stated rules; repo layout, TODO list, commands, freeze tags and definition of done updated.
- SPEC.md: applied the BUILD_TASKS.md §16 differences in place (client `event_id`, idempotent ingest with `{accepted, duplicates}`, `previous_tab_ref` + `is_tab_switch` with intent switches at query time, P-owned sessions, streaming grow, split Work Context endpoints, `uuid5` user IDs, `saved_contexts.kind`, `analysis_runs` as a normal table, no `analysis_quality_daily`); full bridge message list; dev-mode auth rules; Entra timebox 6:30–7:45 then fallback by 8:30; 7-item never-cut list; repo layout; §15 marked superseded.
- BUILD_TASKS.md (team-approved edits only): §1 adds `docs/metrics.md` (R), `docs/failure-drills.md` (P) and the `contracts/` ownership note; PRE-S1 `docs/demo-story` → `docs/demo-script.md`; D-6 Entra timebox; P-13 verify step checks `X-Dev-User` → 401 on the deployed API; §16 row for Grove page API calls.
- Follow-up: BUILD_TASKS.md §14 "§25 Repository structure" row adds R metrics and P failure-drills to the `docs/` owners; SPEC.md §4 diagram redrawn so grove JSON flows from the API straight to the Grove page and the service-worker arrow carries only bridge messages.
- README.MD renamed to README.md (git mv); added Limited Use statement, BUILD_TASKS.md links and the plan v3 layout.

### Added

- `contracts/README.md` freeze notice (freeze time marked NEEDS INPUT).

### Verification

- Tests: none; no application code exists.
- Re-audited every edited file against BUILD_TASKS.md; markdownlint run; grep for retired terms.

## [2026-10-03] — Four-person hackathon plan

### Changed
- buildtask.md: rewritten as a 24-hour execution plan with four owners (Roopesh, Shriya, Deep, Pruthvi), Phases 0–7, contract tasks C1–C8, per-owner P0 tasks in the full task format, P1/P2 lists, cut strategy and the Project Definition of Success.
- CLAUDE.md: replaced the module table with per-owner file ownership; added the shared-contracts table (C1–C6) and the contract-change process; strengthened H1 (do not change working code); added H16 (tests are part of the implementation); listed when CLAUDE.md itself may be updated.

### Verification
- Tests: none; no application code exists.
- Manual verification: task ownership cross-checked against SPEC.md §3, §5–§11 and §14.2.

### Notes
- SPEC.md and README.MD were not modified. SPEC §15 (solo build plan) is superseded for scheduling by buildtask.md but still reads as written.
- Nine open questions (Q1–Q9) are recorded in buildtask.md, including conflicts between the ownership brief and SPEC.md on the Grove JSON shape, the event-type field name and P0 scope.
- Grove UI ownership (Shriya) and backend auth ownership (Roopesh) are defaults, not confirmed decisions.
- `packages/shared/fixtures/` and the engine interface (C6) are additions for parallel development; neither is in SPEC.md.

## [2026-10-03] — Documentation initialized

### Added
- SPEC.md: technical specification derived from the TabForest Project Proposal v1.0 (product definition, provenance and confidence rules, feature tiers and cut order, architecture, extension design, the Hollow, AI pipeline and output schema, data model, API, auth, security, failure modes, build plan, evaluation, out of scope).
- CLAUDE.md: development rules, documentation hierarchy, module boundaries, hard rules H1–H15, soft guidelines, AI agent workflow, token-efficient context rules, definition of done.
- buildtask.md: initial task tracker derived from SPEC.md §3 and §15. All implementation tasks are not started.
- changelog.md: this file.

### Changed
- README.MD: replaced the placeholder with a project overview (concept, how it works, grove legend, features, provenance labels, privacy, stack, planned layout).

### Verification
- Tests: none; no application code exists.
- Build: not applicable.
- Manual verification: documents cross-checked against the proposal text.

### Notes
- No application code has been written. The repository has no commits yet.
- Comparison symbols (≥, ≤, ×) in SPEC.md were restored from context after PDF text extraction dropped them; thresholds should be checked against the proposal.
- `GET /health` in SPEC.md §10 is listed as unauthenticated; the proposal mentions it only in the build plan.
- Open items are listed under "TODO / UNDECIDED" in CLAUDE.md.
