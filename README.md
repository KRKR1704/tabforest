# TabForest

> Browsers remember where you went. TabForest remembers why.

TabForest is an AI-powered browser context-memory system. It turns fragmented browsing activity into a living map of what you are trying to accomplish: your goals, the paths you explored, what you decided, what is still open, and where to resume.

It is not a tab manager. Tab groups, session savers and AI tab sorters file URLs into topic buckets. TabForest treats tabs as **signals of intent** and reconstructs the goal behind them.

Built for GirlHacks 2026 (NJIT).

> **Status:** pre-implementation. This repository currently holds the specification and the team plan. See [SPEC.md](SPEC.md) for the full build contract and [BUILD_TASKS.md](BUILD_TASKS.md) for lanes, tasks and timeline.

## The difference

Six tabs about authentication, plus four searches over the last hour.

A generic AI tab grouper says: **Authentication · 6 tabs.** Correct, and almost useless when you come back.

TabForest says:

| | |
|---|---|
| **Goal** | Choose an authentication architecture for the app *(inferred · 0.82)* |
| **Paths** | JWT · OAuth 2.0 · Server sessions |
| **Direction** | JWT appears preferred *(inferred · 0.71)* |
| **Decision** | "Not using OAuth providers for v1" *(stated · your note)* |
| **Open** | Where should refresh tokens be stored securely? |
| **Next** | Prototype a refresh flow with HttpOnly, SameSite cookies |
| **Resume** | Reopen 4 of 6 tabs |

## How it works

```
Chrome captures the signals
  → the Hollow filters them        (on device)
  → Tiger Data remembers when      (time-series memory)
  → Azure understands why          (intent reconstruction)
  → the Grove shows it             (D3 forest)
```

1. A Manifest V3 extension captures tab events: open, focus, blur, update, close, idle.
2. **The Hollow**, a local privacy layer, drops sensitive tabs, redacts titles and keeps full URLs on the device.
3. Events land in a Tiger Cloud hypertable. Continuous aggregates compute attention per tab over time.
4. The engine clusters tabs deterministically (embeddings + opener chains + time adjacency), then makes one Azure OpenAI Structured Outputs call per cluster.
5. A server-side validator checks every claim against its evidence and caps confidence accordingly.
6. The result renders as the Living Grove.

## The Living Grove

Every visual element encodes a data property.

| Element | Means |
|---|---|
| Tree | A goal. Trunk thickness is the time you spent; canopy turns amber when dormant |
| Branch | A research path |
| Leaf | A tab. Click to reopen |
| Mushroom | A question you never answered |
| Stone | A decision. Carved if you said it, moss-covered if inferred |
| Fog | Where the AI is not sure |
| Roots | The evidence behind any claim |
| Vine | Redundant sources |
| Firefly | A link to research you did before |

## Features

**Core (P0)**

- Real Chrome tab capture with the Hollow
- Time-series event memory in Tiger Data
- AI intent reconstruction with provenance and evidence
- Living Grove visualization and tree detail
- Research timeline
- Save and resume context: reopen only the tabs that matter
- Private accounts with per-user data isolation

**Supporting (P1)**

- **Work Context Mode**: hand it a ticket, a PR, a meeting transcript and a PDF; get back one project state with decisions (verified quotes), blockers, owners, open questions and a handoff brief
- Grow animation
- Privacy panel with a live "what we send" preview
- "Have I researched this before?" memory search
- Pruning suggestions. TabForest suggests; it never closes a tab on its own

## Honest by construction

Every claim carries one of four provenance labels, enforced by the server rather than the prompt:

| Label | Rule |
|---|---|
| **Stated** | You said it. Must reference a real note you wrote |
| **Sourced** | A document you supplied says it. Must include a verbatim quote the server can find in the text |
| **Inferred** | Supported by behavior. Needs at least two valid evidence references and confidence ≥ 0.60. Shown as "appears to…" |
| **Hypothesis** | Weakly supported. Shown in fog, prefixed "Maybe:" |

Confidence is capped by the amount and diversity of evidence, not by the model's self-report.

## Privacy

- Sensitive sites (banking, health, personal email, password managers, sign-in pages) rest in the Hollow and produce no events at all.
- Full URLs, query strings and Chrome tab IDs stay on the device.
- Page titles are redacted locally before upload.
- Page text is read only when you explicitly add a page to Work Context.
- Incognito is disabled at the manifest level.
- No `history`, `cookies`, `webRequest` or host permissions. No content scripts.
- Pause capture, exclude domains, choose retention (7 / 30 / 90 days), or delete everything at any time.

**Limited Use:** data is used only to provide TabForest features. It is never sold, never used for advertising, and never used to train models.

## Tech stack

| Layer | Choice |
|---|---|
| Extension | Manifest V3 · TypeScript · React 18 · Tailwind · Vite + CRXJS |
| Visualization | D3.js v7 on SVG |
| Backend | Python 3.12 · FastAPI · Pydantic v2 · asyncpg · scikit-learn |
| AI | Azure OpenAI (Structured Outputs + `text-embedding-3-small`, Prompt Shields) |
| Memory | Tiger Cloud: hypertables, continuous aggregates, pgvector + pgvectorscale |
| Auth | Microsoft Entra ID (PKCE) |
| Hosting | Azure App Service · Application Insights |

## Repository layout (planned)

```
apps/
  extension/     MV3 extension: service worker; bundles the grove UI as grove.html
  grove/         Grove UI: React + D3 Living Grove (standalone Vite app)
  api/           FastAPI: platform (ingest, auth, timeline) + app/engine (clustering, inference, validation)
  demo-seed/     Seed script for demo history
contracts/       Frozen example payloads + bridge.types.ts (no shared runtime package)
db/migrations/   Plain SQL migrations: 1xx (platform), 2xx (engine)
infrastructure/  Azure deploy script
docs/            Architecture, metrics, privacy, demo script, failure drills
```

## Development (planned)

Nothing is runnable yet. Once the scaffold lands, the local loop will be:

```bash
pnpm dev
```

```bash
uv run uvicorn app.main:app --reload
```

The extension loads unpacked from `apps/extension/dist`. The API runs from `apps/api` against a Tiger Cloud dev service and needs an `apps/api/.env`; the variables are listed in [SPEC.md](SPEC.md#141-environment-variables).

## Documentation

- [SPEC.md](SPEC.md): requirements, architecture, data model, API, security
- [BUILD_TASKS.md](BUILD_TASKS.md): team lanes, ownership, tasks, timeline, cut order (plan v3)
- [CLAUDE.md](CLAUDE.md): development rules for the team and AI agents
- [changelog.md](changelog.md): what changed
