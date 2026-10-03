# Changelog

Chronological record of what actually changed. Newest first. This is history, not a specification: intended behavior lives in [SPEC.md](SPEC.md).

Entry rules: record every meaningful implementation change (not tiny typos); be specific ("Added POST /api/events ingestion endpoint and validated event payloads with Pydantic", not "Updated backend"); no large code blocks; omit empty headings.

Headings per entry: Added · Changed · Fixed · Removed · Tests · Verification · Notes.

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
