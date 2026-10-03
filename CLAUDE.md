# CLAUDE.md — TabForest development rules

How this project is changed. Read this first, every session. It applies to the four developers and to AI coding agents alike.

This file is meant to stay stable. Update it only when architecture, development rules, module ownership, project-wide conventions, testing strategy or the agent workflow change. Do not rewrite it per feature.

## Documentation hierarchy

| File | Role | Answers |
|---|---|---|
| [SPEC.md](SPEC.md) | Product and technical specification. Primary source of truth for requirements | What should the system do? |
| CLAUDE.md | Development rules, ownership, contracts, agent workflow | How do we change it? |
| [buildtask.md](buildtask.md) | 24-hour plan and current state | Who does what, what is done, what is next? |
| [changelog.md](changelog.md) | Chronological record of actual changes | What changed recently? |
| [README.MD](README.MD) | Overview, setup, usage | What is this project? |

Reading order for any task:

```
CLAUDE.md → buildtask.md → recent changelog.md → relevant SPEC.md section → relevant source code
```

Which file to trust for what:

```
SPEC.md       → intended behavior
code          → current implementation
changelog.md  → what changed (history, never a specification)
buildtask.md  → current work state, owners, schedule
CLAUDE.md     → development rules
```

When these conflict, do not silently pick one. Name the conflict and resolve it with the owners.

## Project summary

TabForest is a context-memory and intent-reconstruction system for the browser. A Manifest V3 Chrome extension captures a privacy-filtered stream of tab events; a FastAPI engine stores them as time series in Tiger Data, clusters tabs deterministically, and uses Azure OpenAI to reconstruct the goal behind each cluster. The result renders as the Living Grove (D3 on SVG). The unit is the **goal**, not the tab. Details: SPEC.md §1–2.

**Context:** a 24-hour hackathon, four developers of equal level (Roopesh, Shriya, Deep, Pruthvi), heavy use of AI coding agents.

**Current state:** see buildtask.md. Everything under "Repository structure" is planned until buildtask.md says otherwise.

## Architecture

```
Chrome tab/idle events
  → service worker: normalize → THE HOLLOW (filter, redact) → local queue
  → POST /api/events (batch every 10 s, bearer token)
  → FastAPI: ingest → Tiger Data hypertable + continuous aggregates
  → POST /api/grove/grow: dedupe → embed → cluster → open-loop detect
      → one Azure OpenAI Structured Outputs call per cluster
      → validate evidence / provenance / confidence → persist
  → Grove JSON → React + D3 grove page
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
apps/extension/     MV3 extension: src/background (service worker), src/grove (React + D3)
apps/api/           FastAPI: app/routers, app/engine, app/db, app/demo, tests
apps/demo-seed/     Seed loader for demo data
packages/shared/    schema/ (frozen contracts) and fixtures/ (shared test and demo data)
db/migrations/      Plain SQL: 001_core.sql … 004_vector.sql
infrastructure/     azure/deploy.sh
docs/               architecture.md, privacy.md, demo-script.md
```

File-level layout: SPEC.md §14.2. `packages/shared/fixtures/` is an addition for parallel development; it is not in SPEC §14.2.

## Ownership

Four workstreams. Each owner works inside their own files and meets the others only at a frozen contract. The full task list, schedule and open ownership questions (Q1, Q7) are in buildtask.md.

| Owner | Workstream | Files owned | Develops against |
|---|---|---|---|
| **Roopesh** | Extension, capture, the Hollow, sign-in | `apps/extension/manifest.config.ts`, `apps/extension/src/background/**`, grove `routes/Privacy`, `apps/api/app/auth.py`, `routers/me` | Mocked API responses |
| **Deep** | Database, FastAPI, Tiger Data | `db/migrations/**`, `apps/api/app/{main.py,db/**,routers/{events,grove,projects,privacy}}`, `apps/demo-seed/**`, `infrastructure/**`, grove `routes/Timeline` | Fixture events, fixture IntentCluster output |
| **Pruthvi** | AI: grouping, intent, validation | `apps/api/app/engine/**`, `routers/{memory,work_context}`, the Pydantic models behind `intent.schema.json` | Fixture JSON, no live database |
| **Shriya** | Grove UI, save/resume, demo, submission | `apps/extension/src/grove/**` except `routes/Privacy` and `routes/Timeline`, `packages/shared/fixtures/**`, `docs/demo-script.md` | Fixture Grove JSON, mocked worker messages |

Rules:

- Do not edit files another person owns. Ask the owner, or change the contract by the process below.
- Nobody waits on another person's implementation. If your input is not ready, use the fixtures.
- An AI agent working for one owner stays inside that owner's files.

## Shared contracts

Agreed and frozen in Phase 0, before parallel work starts. They live in `packages/shared/schema/`; fixtures that conform to them live in `packages/shared/fixtures/`.

| ID | Contract | Baseline | Producer → Consumer |
|---|---|---|---|
| C1 | BrowserEvent and batch envelope | SPEC §8.2, §10.1 | Roopesh → Deep |
| C2 | IntentCluster (model output) | SPEC §7.4 | Pruthvi → Deep |
| C3 | Grove JSON | SPEC §10.1 | Deep → Shriya |
| C4 | API endpoints | SPEC §10 | Deep → Roopesh, Shriya |
| C5 | Worker messages | SPEC §5.4 | Roopesh ↔ Shriya |
| C6 | Engine interface (proposed; not in SPEC) | buildtask.md C6 | Pruthvi → Deep |

Standing rules for contracts:

- The grove page never calls the API directly and never holds the token. Only the service worker does (SPEC §5.4).
- The server never supplies a URL to open. Tabs reopen from local storage by `tab_ref` (SPEC §4.1).
- `intent.schema.json` is generated from the Pydantic models. Change the models, then regenerate. Never hand-edit it.
- The engine takes plain data and returns IntentCluster objects. It does not import `app/db`.

**Changing a frozen contract:**

1. Identify the affected owners and tell them.
2. Update the schema.
3. Update the fixtures and the affected tests.
4. Update changelog.md.
5. Update buildtask.md.

## TODO / UNDECIDED

Not established by SPEC.md. Do not guess. Open team decisions Q1–Q9 are tracked in buildtask.md.

- SQL for `search_activity_1h` and `analysis_quality_daily` (named in SPEC §8.3, no definition)
- Request and response bodies for endpoints without an example in SPEC §10.1
- How TypeScript types are generated from the JSON Schema (tool not named)
- Split of tables across `001_core.sql … 004_vector.sql`
- Exact chat model deployment name
- CI contents beyond `.github/workflows/api.yml` existing
- Test, lint, type-check and migration commands (record here once the scaffold exists)

## Development workflow

```
CONTRACT FIRST → PARALLEL DEVELOPMENT → INTEGRATION → TESTING → DEMO → SUBMISSION
```

Planned commands (SPEC §14). Not runnable until the scaffold exists.

```
pnpm dev                                   # extension with HMR, load unpacked
uv run uvicorn app.main:app --reload       # API, from apps/api
```

Priorities: **P0** must work for the demo · **P1** important if time permits · **P2** polish. If P0 is unstable, stop P1 and P2 work. The cut strategy and never-cut list are in buildtask.md.

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
Do not change API contracts, database contracts, shared types, JSON schemas, environment variable names, component interfaces or function signatures unless the task explicitly requires it. Frozen contracts C1–C6 change only by the contract-change process above.

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

1. Update changelog.md. Not for tiny typos; always for implementation changes.
2. Update buildtask.md: status, completed work, remaining work, blockers, test status.
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

Tests replace authentication with FastAPI dependency overrides in test code. There is no auth-bypass switch in application code.

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

**Step 1 — Establish context.** Read CLAUDE.md, buildtask.md, and the relevant recent section of changelog.md. Do not read the whole repository.

**Step 2 — Understand the task.** Determine what must change, which owner and module it belongs to, what existing behavior must stay unchanged, and which spec section applies.

**Step 3 — Read only the relevant specification.** Open only that part of SPEC.md.

**Step 4 — Inspect relevant code.** Search for the existing implementation, related functions, contracts, types, tests and fixtures. Do not browse unrelated files.

**Step 5 — Plan before editing.** For non-trivial tasks, state the files to change, the approach, the risks and the tests to run.

**Step 6 — Implement minimally.** The smallest change that satisfies the task, inside the owner's files, with its tests.

**Step 7 — Verify.** Run the appropriate tests, type checks, lint, build and manual verification.

**Step 8 — Update documentation.** buildtask.md and changelog.md every time; CLAUDE.md only under the conditions in H10.

**Step 9 — Final response.** Report what changed, files changed, what was intentionally not changed, verification performed, documentation updated, and remaining issues or blockers.

## Token-efficient context

| Task | Read | Then |
|---|---|---|
| Small bug | CLAUDE.md, buildtask.md, latest relevant changelog entry | Inspect only the affected code |
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
| 6 | Privacy — the Hollow | 15 | Build plan (solo; superseded by buildtask.md) |
| 7 | AI pipeline and output schema | 16 | Evaluation |
| 8 | Data model | 17 | Out of scope |
| 9 | Living Grove UI | | |

## Before modifying existing code

1. Determine whether it is working.
2. Understand what consumes it.
3. Search for references.
4. Check the relevant tests.
5. Check recent changelog entries.
6. Check buildtask.md status and owner.
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
- Branching and review workflow: decided in Phase 0 (buildtask.md Q8); record it here once agreed.

# What not to do

- Do not build anything in SPEC §17 (out of scope).
- Do not work on P1 or P2 while P0 is unstable.
- Do not start broad implementation before the Phase 0 contracts are agreed.
- Do not introduce architecture changes after the core freeze (Phase 5).
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
- [ ] changelog.md is updated.
- [ ] buildtask.md is updated.
- [ ] CLAUDE.md is updated if architecture, ownership or rules changed.
- [ ] No secrets were introduced.
- [ ] Known limitations are documented.

Project-level success criteria: buildtask.md, "Project Definition of Success".
