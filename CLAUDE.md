# CLAUDE.md — TabForest development rules

How this project is changed. Read this first, every session. It applies to the four developers and to AI coding agents alike.

This file is meant to stay stable. Update it only when architecture, development rules, module ownership, project-wide conventions, testing strategy or the agent workflow change. Do not rewrite it per feature.

## Documentation hierarchy

| File | Role | Answers |
|---|---|---|
| [BUILD_TASKS.md](BUILD_TASKS.md) | Team plan v3: lanes, ownership, task IDs, endpoints, tables, `contracts/`, timeline, cut order, definition of done. Frozen | Who owns what, which task, when? |
| [SPEC.md](SPEC.md) | Product and technical specification. Primary source of truth for product behavior | What should the system do? |
| CLAUDE.md | Development rules, contracts, agent workflow | How do we change it? |
| [changelog.md](changelog.md) | Chronological record of actual changes | What changed recently? |
| [README.md](README.md) | Overview, setup, usage | What is this project? |

BUILD_TASKS.md is frozen. Only Roopesh (R) changes it, and only by team decision.

Reading order for any task:

```
CLAUDE.md → BUILD_TASKS.md (your lane + §4) → recent changelog.md → relevant SPEC.md section → relevant source code
```

Which file to trust for what:

```
BUILD_TASKS.md → lanes, ownership, endpoints, tables, contracts, schedule; overrides SPEC.md where its §16 says so
SPEC.md        → intended product behavior
code           → current implementation
changelog.md   → what changed (history, never a specification)
CLAUDE.md      → development rules
```

When these conflict, do not silently pick one. Name the conflict and resolve it with the owners.

## Project summary

TabForest is a context-memory and intent-reconstruction system for the browser. A Manifest V3 Chrome extension captures a privacy-filtered stream of tab events; a FastAPI engine stores them as time series in Tiger Data, clusters tabs deterministically, and uses Azure OpenAI to reconstruct the goal behind each cluster. The result renders as the Living Grove (D3 on SVG). The unit is the **goal**, not the tab. Details: SPEC.md §1–2.

**Context:** a 24-hour hackathon (GirlHacks 2026), four developers of equal level (Roopesh = R, Shriya = S, Deep = D, Pruthvi = P), heavy use of AI coding agents.

**Current state:** pre-event. The plan is BUILD_TASKS.md; recent progress is in changelog.md. Everything under "Repository structure" is planned until the code exists.

## Architecture

```
Chrome tab/idle events
  → service worker: normalize → THE HOLLOW (filter, redact) → local queue (client event_id)
  → POST /api/events (batch every 10 s, bearer token)
  → FastAPI: idempotent ingest (INSERT … ON CONFLICT DO NOTHING) → Tiger Data hypertable + continuous aggregates
  → grove page: POST /api/grove/grow?stream=1: dedupe → embed → cluster → open-loop detect
      → NDJSON clusters line, then one Azure OpenAI Structured Outputs call per cluster
      → validate evidence / provenance / confidence → persist → tree line per cluster → done
  → React + D3 grove page
```

Full flow: SPEC.md §4. Pipeline steps: SPEC.md §7.

## Technology stack

| Layer | Choice |
|---|---|
| Extension | Manifest V3 · TypeScript · React 18 · Tailwind · Vite + CRXJS · Zustand · TanStack Query |
| Visualization | D3.js v7 on SVG |
| Backend | Python 3.12 · FastAPI · Pydantic v2 · asyncpg · scikit-learn · pypdf · slowapi · PyJWT |
| AI | Azure OpenAI: chat with Structured Outputs + `text-embedding-3-small` |
| Memory | Tiger Cloud (TimescaleDB + pgvector + pgvectorscale) |
| Auth | Microsoft Entra ID (PKCE), JWKS validation |
| Hosting | Azure App Service · Application Insights |
| Tooling | pnpm workspaces · uv · Ruff · Vitest · Pytest |

Do not substitute any of these without a spec change. See SPEC.md §14.

## Repository structure (planned)

```
apps/extension/     MV3 extension: service worker; bundles apps/grove/dist as grove.html (D)
apps/grove/         Grove UI: React + D3, standalone Vite app (S)
apps/api/           FastAPI: app/ platform (P) · app/engine/ intelligence engine (R) · tests (P)
apps/demo-seed/     Seed loader for demo data (P)
contracts/          Frozen example payloads + bridge.types.ts (no lane owns it during the event)
db/migrations/      Plain SQL: 1xx_*.sql (P) · 2xx_*.sql (R); db/migrate.sh (P)
infrastructure/     azure/deploy.sh (P)
.github/workflows/  CI/CD (P)
devpost/, pitch/    Submission and pitch (S)
docs/               architecture.md, metrics.md (R) · privacy.md (D) · demo-script.md (S) · failure-drills.md (P)
```

File-level layout: SPEC.md §14.2. There is no shared runtime package (BUILD_TASKS.md §16).

## Ownership

Four lanes (BUILD_TASKS.md §1). Each owner edits only their own folders and meets the others only at a frozen `contracts/` example and a consumer-owned adapter. Task IDs, hours and verify steps are in BUILD_TASKS.md §6–§9.

| Owner | Lane | Folders only this person edits |
|---|---|---|
| **Roopesh (R)** | Intelligence engine (core): normalization, clustering, open loops, Azure OpenAI, evidence validator, Work Context, research memory, pruning, AI endpoints | `apps/api/app/engine/` · `db/migrations/2xx_*.sql` · `docs/architecture.md` · `docs/metrics.md` |
| **Shriya (S)** | Grove UI + pitch: every screen, D3 Living Grove, grow orchestration (S-6), wow animation, Devpost, pitch, demo script, backup video, README | `apps/grove/` · `docs/demo-script.md` · `devpost/` · `pitch/` · `README.md` |
| **Deep (D)** | Chrome extension: service worker, capture, the Hollow, local queue, Entra sign-in, open/close/restore tabs, Work Context capture, bundling the UI | `apps/extension/` · `docs/privacy.md` |
| **Pruthvi (P)** | Platform + memory: FastAPI app, auth, event storage (hypertable + aggregates), sessions, timeline, saved contexts, privacy, deletion, isolation tests, Azure deployment, demo seed | `apps/api/app/` except `engine/` · `apps/api/tests/` · `db/migrations/1xx_*.sql` · `db/migrate.sh` · `infrastructure/azure/` · `.github/workflows/` · `apps/demo-seed/` · `docs/failure-drills.md` |

Endpoint ownership: BUILD_TASKS.md §4.4. Table and column ownership: BUILD_TASKS.md §4.5.

Rules:

- Do not edit files another person owns. Ask the owner.
- Nobody waits on another person's implementation. Every lane builds its own stand-ins (mock API, mock bridge, fixture rows) seeded from `contracts/`.
- One adapter file per connection, owned by the consumer. Every adapter falls back to its stand-in when the real thing is missing or failing.
- Shared tables use column-level ownership. No foreign keys across lanes.
- An AI agent working for one owner stays inside that owner's folders.

## Shared contracts

Connections C1–C14 are listed in BUILD_TASKS.md §3. Each is shown as an exact example payload in the `contracts/` folder (BUILD_TASKS.md §5.1), drafted before the event and frozen by R with the git tag `contracts-frozen`. Each lane keeps its own types (Pydantic or TypeScript) and tests against those payloads.

Standing rules for contracts:

- The token is persisted only in `chrome.storage.session` by the service worker. The grove page gets it with `GET_TOKEN`, keeps it in memory only (never `localStorage` or IndexedDB), and calls the API itself with `fetch` (BUILD_TASKS.md §4.3, §16).
- The server never supplies a URL to open. Tabs reopen from local storage by `tab_ref` (SPEC §4.1).
- There is exactly one production auth implementation: P's `current_user()`. R's routes use it through `dependency_overrides` when mounted; R writes no JWT or JWKS validation (BUILD_TASKS.md §4.1).
- R never imports P's code. R reads P's tables through its own adapters (C11, C13) and writes only R's tables and R's `tabs` columns; P reads R's tables through C12.
- P is the only owner of sessions; R never computes sessions (BUILD_TASKS.md §4.11).

**`contracts/` is never edited during the event.** A mismatch found later is fixed in the consumer's adapter (BUILD_TASKS.md §2 rule 3), and recorded in changelog.md.

## TODO / UNDECIDED

Not established by SPEC.md or BUILD_TASKS.md. Do not guess.

- SQL for `search_activity_1h` (named in SPEC §8.3, no definition; owner P, task P-3)
- Request and response bodies for endpoints without an example in SPEC §10.1 (the `contracts/` examples will define them)
- Exact chat model deployment name
- Test, lint, type-check and migration commands (record here once the scaffold exists)

Settled by BUILD_TASKS.md: migrations are split by owner (`1xx` P, `2xx` R); no TypeScript type generation (each lane writes its own types); CI deploys the API on push to `main` and runs migrations (P-14); AI-quality trends live in Application Insights, not a database aggregate (§4.8).

## Development workflow

```
CONTRACT FIRST → PARALLEL DEVELOPMENT → INTEGRATION → TESTING → DEMO → SUBMISSION
```

Planned commands (SPEC §14). Not runnable until the scaffold exists.

```
pnpm dev                                          # extension with HMR, load unpacked
uv run uvicorn app.main:app --reload              # API, from apps/api
uv run uvicorn app.engine.standalone:app --reload # R's endpoints alone (X-Dev-User only), from apps/api
```

Priorities: **P0** must work for the demo · **P1** important if time permits · **P2** polish. If P0 is unstable, stop P1 and P2 work. The cut order and never-cut list are in BUILD_TASKS.md §15; integration windows (H6.5 smoke test, H10, H15–18, H19.5, freeze H21.5) in §11.

---

# HARD RULES

Non-negotiable.

### H1. Do not change working code

The strongest rule in this file. If existing functionality works, do not modify it unless the current task requires it.

```
PRESERVE → EXTEND → TEST → VERIFY        not        REWRITE
```

Do not:

- refactor unnecessarily
- rename working code for style
- replace libraries without need
- rewrite working components
- change architecture because another approach seems cleaner
- modify unrelated files

Modify working code only when the current task requires it, there is a verified bug, the spec requires a behavioral change, a dependency or security issue requires it, or it is necessary for integration.

### H2. Make the smallest change possible
`minimal change → test → verify → document`. Do not expand a task's scope without a clear reason.

### H3. Never silently change requirements
If implementation conflicts with SPEC.md: identify the conflict, do not reinterpret the requirement, explain it, and ask for clarification if needed.

### H4. Do not invent APIs, database fields, services or architecture
Use SPEC.md, source code, schemas, API definitions, database definitions and configuration as evidence. No imaginary integrations. If the spec is silent, mark it TODO / UNDECIDED and ask.

### H5. Preserve interfaces
Do not change API contracts, database contracts, shared types, JSON schemas, environment variable names, component interfaces or function signatures unless the task explicitly requires it. The `contracts/` examples are frozen and never edited during the event; mismatches are fixed in the consumer's adapter (see "Shared contracts").

### H6. Do not delete functionality without explicit justification
Never remove working functionality because it is not currently needed.

### H7. No unnecessary dependencies
Do not add a package when an existing dependency solves the problem. If one is necessary: explain why, confirm nothing existing provides it, and add the minimum.

### H8. No secrets
Never hardcode API keys, tokens, passwords, credentials, private URLs or production secrets. Never commit `.env` files. The only identifier allowed in the extension bundle is the public Entra client ID (SPEC §12).

### H9. Validate changes
After modifying code: run the most relevant tests, run type checking and linting where applicable, verify the affected functionality, and report anything that could not be verified. Never claim something works if it was not verified.

### H10. Documentation must stay synchronized
After every meaningful code or architecture change, in the same piece of work:

1. Add a changelog.md entry for every change (not for tiny typos): what changed, which task ID, tests, verification, blockers.
2. Do not edit BUILD_TASKS.md. It is frozen; only Roopesh (R) changes it, and only by team decision.
3. Update CLAUDE.md only if architecture, rules, ownership, conventions, testing strategy or agent workflow changed.
4. Update SPEC.md only when the specification itself intentionally changed.

### H11. Never fabricate completion
Do not mark a task complete, tested, verified or deployed unless it happened.

### H12. Preserve unrelated work
Inspect `git status` first. Do not overwrite another developer's uncommitted work, revert unrelated changes, or "clean up" files outside the task or outside your owner's files.

### H13. Do not weaken security or privacy
Do not bypass authentication, disable validation, expose secrets, log sensitive data, bypass the Hollow, remove authorization checks, or store sensitive data unnecessarily. Temporary debug logging is removed or sanitized before completion. Invariants that must always hold (SPEC §6, §11, §12):

- Every event passes through the Hollow before it is queued, stored or sent.
- Full URLs and Chrome tab IDs stay on the device.
- `user_id` comes from the token, never the request body. Every SQL statement filters on it. A miss returns 404.
- No `history`, `cookies`, `webRequest`, `webNavigation` or host permissions. No static content scripts. `"incognito": "not_allowed"`.
- Tabs are closed only after an explicit user click.
- Model and page text are rendered as text nodes. No `innerHTML` / `dangerouslySetInnerHTML`.
- Logs and telemetry contain no titles or page text.
- Provenance and confidence rules are enforced by server code, not by the prompt (SPEC §2.3–2.4).

Tests replace authentication with FastAPI dependency overrides in test code. The only auth bypass allowed in application code is `AUTH_MODE=dev` (dev header `X-Dev-User`, BUILD_TASKS.md §4.1), under these rules:

- Default is `AUTH_MODE=prod`. dev mode is only for local runs and the H6.5 smoke test.
- The app logs a loud startup warning whenever `AUTH_MODE=dev`.
- P switches the deployed App Service back to `AUTH_MODE=prod` right after the H6.5 smoke test.
- P-13's verify step must show that `X-Dev-User` returns 401 on the deployed API.

### H14. Treat database changes as high-risk
Before changing schema, migrations, indexes, relationships or stored data formats, check all consumers. Do not casually rename fields or change types. Prefer additive migrations. Never delete user data as part of a normal development task unless explicitly requested.

### H15. Treat APIs as contracts
Before changing an API: find all callers and consumers, update shared types and schemas, update tests, document the change. Avoid breaking changes unless explicitly required.

### H16. TESTS ARE PART OF THE IMPLEMENTATION

Every meaningful implementation change includes appropriate tests. Tests are not optional cleanup.

```
implementation + test/fixture + verification + documentation
```

| Area | Expected tests |
|---|---|
| Extension | Event capture, Hollow exclusion, event normalization |
| Backend | API tests, database/repository tests, schema validation |
| AI | Clustering fixtures, open-loop detection, structured-output validation, evidence validation |
| Frontend | Component tests where practical, Grove data rendering, interaction tests for critical functionality |
| Integration | End-to-end smoke test for the critical demo path |

For bug fixes:

1. Reproduce the bug.
2. Add a regression test.
3. Fix the bug.
4. Verify the regression test passes.

A change is not complete if its relevant test coverage is missing, unless testing is impractical. If so, say why in the changelog. Tests go in the appropriate test directory and follow existing conventions. Never delete or weaken an existing test to make a new implementation pass.

---

# SOFT GUIDELINES

Preferred practices. They may be overridden when SPEC.md or the task requires otherwise.

- Prefer simple solutions over clever ones.
- Prefer existing project patterns.
- Keep functions and components focused.
- Keep changes easy to review.
- Use meaningful names.
- Avoid premature abstraction.
- Avoid unnecessary comments; document why, not what.
- Keep code consistent with surrounding code.
- Prefer deterministic behavior. Use code for duplicate detection, time and dwell calculations, opener relationships, search-family detection and evidence validation. Use the model only to interpret clustered signals: goals, decisions, open questions, next actions.
- Keep error handling explicit.
- Consider performance only where relevant to the actual workload.
- Consider privacy and security whenever user data is handled.
- Prefer incremental implementation.
- Keep commits logically scoped.
- Avoid broad refactors during feature work.

---

# AI AGENT WORKFLOW

```
UNDERSTAND → PLAN → MINIMAL CHANGE → TEST → VERIFY → DOCUMENT → REPORT
```

Not: read everything → rewrite everything → break features → leave docs stale.

**Step 1 — Establish context.** Read CLAUDE.md, your lane and §4 of BUILD_TASKS.md, and the relevant recent section of changelog.md. Do not read the whole repository.

**Step 2 — Understand the task.** Determine what must change, which owner and module it belongs to, what existing behavior must stay unchanged, and which spec section applies.

**Step 3 — Read only the relevant specification.** Open only that part of SPEC.md.

**Step 4 — Inspect relevant code.** Search for the existing implementation, related functions, contracts, types, tests and fixtures. Do not browse unrelated files.

**Step 5 — Plan before editing.** For non-trivial tasks, state the files to change, the approach, the risks and the tests to run.

**Step 6 — Implement minimally.** The smallest change that satisfies the task, inside the owner's files, with its tests.

**Step 7 — Verify.** Run the appropriate tests, type checks, lint, build and manual verification.

**Step 8 — Update documentation.** changelog.md every time; CLAUDE.md and SPEC.md only under the conditions in H10. Never BUILD_TASKS.md.

**Step 9 — Final response.** Report what changed, files changed, what was intentionally not changed, verification performed, documentation updated, and remaining issues or blockers.

## Token-efficient context

| Task | Read | Then |
|---|---|---|
| Small bug | CLAUDE.md, your lane in BUILD_TASKS.md, latest relevant changelog entry | Inspect only the affected code |
| Feature | The above + relevant changelog entries + the relevant SPEC.md section | Inspect the affected modules |
| Architecture change | The above + all relevant SPEC.md sections | Inspect the affected architecture and code. Read the full spec only if necessary |

SPEC.md section index:

| § | Topic | § | Topic |
|---|---|---|---|
| 1 | Product definition | 10 | API |
| 2 | Concepts: intent, provenance, confidence | 11 | Accounts and isolation |
| 3 | Features, priorities, cut order | 12 | Security |
| 4 | Architecture and request flow | 13 | Failure modes |
| 5 | Chrome extension | 14 | Stack, env vars, repo layout |
| 6 | Privacy — the Hollow | 15 | Build plan (solo; superseded by BUILD_TASKS.md §5–§13) |
| 7 | AI pipeline and output schema | 16 | Evaluation |
| 8 | Data model | 17 | Out of scope |
| 9 | Living Grove UI | | |

## Before modifying existing code

1. Determine whether it is working.
2. Understand what consumes it.
3. Search for references.
4. Check the relevant tests.
5. Check recent changelog entries.
6. Check the owner in BUILD_TASKS.md §1 and the task in §6–§9.
7. Check the spec requirement.

If the change can be made without touching working code, prefer that.

## When something is unclear

Do not guess when the ambiguity affects architecture, security, data integrity or user-visible behavior. Identify it, explain the possible interpretations, choose the least destructive option only when that is safe, and otherwise ask. Never silently invent requirements.

---

# Git and change discipline

- Check `git status` before starting. Leave others' uncommitted work alone.
- One logical change per commit. No drive-by edits.
- Commit or push only when asked.
- Never commit `.env`, tokens or keys.
- Branching and review workflow: not yet decided; record it here once agreed. Freeze tags: `contracts-frozen` (before the event), `demo-v1` (H21.5).

# What not to do

- Do not build anything in SPEC §17 (out of scope).
- Do not work on P1 or P2 while P0 is unstable.
- Do not start broad implementation before the `contracts/` folder is frozen (PRE-C1, tag `contracts-frozen`).
- Do not add features after the feature freeze at H21.5 (tag `demo-v1`); bug fixes only.
- Do not edit another owner's files.
- Do not read the whole repository for a scoped task.
- Do not treat changelog.md as a specification.
- Do not paste README or SPEC content into this file; link to it.

# Definition of done

- [ ] Implementation is finished.
- [ ] Tests for the change exist and pass (H16).
- [ ] Build, type and lint checks pass where applicable.
- [ ] Existing functionality is preserved.
- [ ] No unrelated files were changed.
- [ ] changelog.md has an entry for the change.
- [ ] CLAUDE.md is updated if architecture, ownership or rules changed.
- [ ] No secrets were introduced.
- [ ] Known limitations are documented.

Project-level success criteria: BUILD_TASKS.md §17, "Definition of done".
