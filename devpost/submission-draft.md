# TabForest — Devpost Submission Draft

> **Tagline:** Browsers remember where you went. TabForest remembers why.

**Event:** GirlHacks 2026 (NJIT)  
**Tracks:** 
1. **Azure AI Track** (Azure OpenAI Structured Outputs, Prompt Shields content filtering, Azure App Service, Application Insights)
2. **Tiger Data Memory Track** (TimescaleDB time-series hypertables, continuous aggregates, pgvector DiskANN vector embeddings)

---

## 💡 Inspiration

Every knowledge worker and developer knows the feeling: you dive into a deep technical rabbit hole, opening 40 tabs across documentation, GitHub issues, StackOverflow questions, and blog posts. Two hours later, a meeting interrupts you. When you come back tomorrow, all you see is a daunting wall of favicon clutter.

Standard tab managers save a flat graveyard of URLs. But URLs only tell you **where** you went—they don't remember **why**. 

We built **TabForest** to be a context-memory and intent-reconstruction system. Its fundamental unit is not the page—it is the **goal**.

---

## 🌲 What It Does

TabForest turns noisy browser tab sprawl into the **Living Grove**—a parameterized SVG forest visualization where every visual trait encodes real data properties:

1. **Intent Reconstruction**: Instead of organizing by domain, TabForest computes deterministic affinity clusters and leverages **Azure OpenAI Structured Outputs** to reconstruct your high-level goal, sub-branches, current direction, and concrete decisions.
2. **Unresolved Question Detection**: When you repeatedly rephrase search queries without finding a settled answer, TabForest flags the open loop as an organic **Mushroom** at the base of your project tree.
3. **Decisions with Provenance**: Reconstructed choices appear as **Stones**. Solid, carved stones represent user-stated or verified sourced facts; mossy stones represent inferred findings with a one-click "Confirm" action.
4. **Subterranean Evidence Roots**: Clicking any goal, decision, or question illuminates the subterranean roots connecting directly to the exact tabs and search queries that formed the conclusion.
5. **Time-Series Memory in Tiger Data**: Tab dwell times and attention spans are continuously aggregated in **TimescaleDB continuous aggregates**, sizing the tree trunk and leaves.
6. **Save $\rightarrow$ Quit $\rightarrow$ Resume**: Save your context with one click, close all 40 tabs, restart your browser, and click "Resume" to restore **only the important tabs** (excluding stale duplicates).
7. **The Hollow (Privacy First)**: Sensitive sites (banking, healthcare, passwords, authentication paths) produce **zero events** and are filtered locally on device.
8. **Work Context Mode**: Right-click any ticket or paste a meeting transcript to extract enterprise decisions, blockers, and copy a formatted handoff brief with verbatim verified quotes.

---

## ⚙️ How We Built It

TabForest is engineered across four independent, high-performance layers:

### 1. The Chrome Extension (Manifest V3)
- Background service worker capturing focus, blur, idle, and navigation events.
- **The Hollow**: On-device privacy firewall that redacts sensitive titles, strips tracking parameters, and discards events from sensitive domains before queuing.
- Secure token storage in `chrome.storage.session` and local URL key-value storage in `chrome.storage.local`.

### 2. Time-Series Memory Engine (Tiger Data / TimescaleDB)
- `browser_events` stored in a high-throughput **TimescaleDB Hypertable** with 1-day chunks and 7-day compression.
- Hierarchical continuous aggregates (`tab_attention_15m` refreshed every minute $\rightarrow$ `user_attention_daily`) measuring attention spans, tab switches, and query-time intent switches without expensive recalculation.
- Fast hybrid vector search with `pgvector` and `vectorscale` DiskANN indexing over project embeddings and research insights.

### 3. Intelligence Engine (Azure OpenAI)
- Embeddings generated via `text-embedding-3-small` (1536-dimensions).
- Intent reasoning using **Azure OpenAI Structured Outputs** (`json_schema` strict validation) executing parallel calls per cluster.
- Strict server-enforced provenance validation: `stated` claims require verified user notes, `sourced` claims require exact substring quotes, and ungrounded inferences are dynamically fogged.
- **Streaming NDJSON grow**: The backend streams `clusters` immediately upon deterministic grouping, followed by individual `tree` payloads as each AI result completes.

### 4. The Living Grove Canvas (React 18 + D3.js)
- Responsive React 18 single-page application bundled with Tailwind CSS, Zustand, and TanStack Query.
- Custom D3 SVG canvas rendering parameterized organic trees, leaves, stones, mushrooms, fog shaders, and blooming flowers.
- Interactive grow animation simulating falling leaves, centroid swirls, trunk growth, and canopy expansion under 4.2 seconds.

---

## 🏆 Accomplishments We're Proud Of

- **Zero Hallucination as Fact**: Every single claim in TabForest carries an immutable provenance badge (`stated`, `sourced`, `inferred`, `hypothesis`). If confidence drops below 60%, the claim is fogged and collapsed by default.
- **Honest Latency via Streaming**: Rather than showing a blank spinner for 5 seconds, the Grove canvas begins animating clusters within 300 ms, streaming trees as each OpenAI call resolves.
- **True Privacy**: Full URLs and query parameters remain in local storage on the client device. TabForest never scrapes the web in the background and requests zero host permissions.
- **Instant Context Restoration**: Resuming a 2-hour research session restores only the 4 most critical tabs rather than reopening 35 redundant tabs.

---

## 🚧 Challenges We Encountered

- **Synchronizing D3 Physics with Streaming React State**: Ensuring incoming NDJSON tree lines smoothly appended to the active SVG hierarchy without interrupting running D3 force simulations or user interactions.
- **Determining Intent Switches vs. Tab Switches**: Distinguishing between normal workflow hopping (e.g., jumping between docs and GitHub in the same project) versus true cognitive context switching. We solved this by recording raw factual hops at ingest and computing intent switches at query time over clustered graphs.

---

## 🔮 What's Next for TabForest (Roadmap)

- **Canopy Seasons**: Visualizing weekly productivity cycles as changing seasons across the Living Grove.
- **Team Grove Handoffs**: Exporting research grove bundles directly into team Slack channels or PR descriptions.
- **Local LLM / Offline Grove**: Running deterministic clustering with small local ONNX models for completely air-gapped environments.

---

## 🛠️ Built With

- **Cloud & AI**: Azure OpenAI (GPT-4.1-mini, text-embedding-3-small), Azure App Service, Azure Application Insights, Microsoft Entra ID
- **Database & Memory**: Tiger Cloud, TimescaleDB, pgvector, pgvectorscale DiskANN, PostgreSQL
- **Frontend & Visualization**: React 18, TypeScript, Vite, D3.js v7, Tailwind CSS, Zustand, TanStack Query, Lucide Icons
- **Browser Extension**: Chrome Manifest V3, WebAuthFlow, CRXJS
- **Backend**: Python 3.12, FastAPI, Pydantic v2, asyncpg, scikit-learn, slowapi, PyJWT, pytest
