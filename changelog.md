# Changelog

Chronological record of what actually changed. Newest first. This is history, not a specification: intended behavior lives in [SPEC.md](SPEC.md).

Entry rules: record every meaningful implementation change (not tiny typos); be specific ("Added POST /api/events ingestion endpoint and validated event payloads with Pydantic", not "Updated backend"); no large code blocks; omit empty headings.

Headings per entry: Added · Changed · Fixed · Removed · Tests · Verification · Notes.

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
