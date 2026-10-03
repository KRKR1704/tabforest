# Changelog

Chronological record of what actually changed. Newest first. This is history, not a specification: intended behavior lives in [SPEC.md](SPEC.md).

Entry rules: record every meaningful implementation change (not tiny typos); be specific ("Added POST /api/events ingestion endpoint and validated event payloads with Pydantic", not "Updated backend"); no large code blocks; omit empty headings.

Headings per entry: Added · Changed · Fixed · Removed · Tests · Verification · Notes.

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
