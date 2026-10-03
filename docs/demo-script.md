# TabForest — Live Demo Script & 28-Tab Narration

**Target Duration:** 2:45 (strictly under 3:00)  
**Speaker:** Shriya (Lane S) + Team  
**Persona:** Maya Lin — CS student & part-time engineer with 40 tabs open across multiple simultaneous tasks.

---

## 1. The 28 Demo Tabs Sequence

The demo uses a realistic, carefully staged browsing sequence of 28 tabs across active research, background tabs, emerging explorations, and sensitive local sites:

### Cluster 1: Backend Authentication (8 tabs · Primary Focus)
1. `fastapi.tiangolo.com/tutorial/security` — *Security - FastAPI Official Documentation* (Docs, 9.5m dwell)
2. `github.com/tiangolo/fastapi/pull/418` — *tiangolo/fastapi: JWT authentication example PR* (Code, 6.2m dwell)
3. `jwt.io/introduction` — *JSON Web Tokens Introduction* (Docs, 14.0m dwell, 3 revisits)
4. `auth0.com/docs/oauth2` — *OAuth 2.0 and OpenID Connect Overview* (Docs, 4.1m dwell)
5. `stackoverflow.com/questions/582...` — *Where to store JWT refresh tokens in React app?* (Q&A, 2.3m dwell, 4 searches)
6. `redis.io/docs/manual/session` — *Session Management with Redis* (Docs, 3.4m dwell)
7. `medium.com/@dev/fastapi-auth` — *FastAPI Auth in 5 Minutes* (Discussion, 1.2m dwell — Redundant)
8. `dev.to/auth-fastapi-mirror` — *FastAPI Auth in 5 Minutes (Mirror)* (Discussion, 0.8m dwell — Exact Duplicate)

### Cluster 2: GirlHacks 2026 Submission (2 tabs · Active Secondary)
9. `girlhacks2026.devpost.com/rules` — *GirlHacks 2026 Submission Rules & Track Criteria* (Work tool, 18.0m dwell)
10. `github.com/tabforest/tabforest` — *tabforest/tabforest: README & Architecture* (Code, 10.0m dwell)

### Cluster 3: Summer 2027 Internships (2 tabs · Dormant 3+ Days)
11. `careers.microsoft.com/us/en/job/...` — *Software Engineering Intern - Cloud & AI* (Work tool, 11.2m dwell, last active 3 days ago)
12. `levels.fyi/internships` — *Software Engineer Intern Salaries & Roles* (Discussion, 4.0m dwell)

### Wildflower Meadow (2 tabs · Low-affinity Singletons)
13. `open.spotify.com/playlist/focus` — *Deep Focus Instrumental Playlist* (25.0m dwell)
14. `weather.com/weather/today/l/Newark+NJ` — *Newark, NJ Hourly Forecast* (0.5m dwell)

### Emerging Sprout (1 tab · Fresh &lt; 15 mins)
15. `docs.timescale.com/vector/diskann` — *DiskANN Indexing on Timescale Vector* (Docs, 2.1m dwell)

### The Hollow (3 tabs · Filtered on device, ZERO events sent)
16. `chase.com/login` — *Chase Personal Banking*
17. `my.1password.com` — *1Password Vault*
18. `accounts.google.com/signin` — *Google Account Authentication*

### Additional Reference & Research Tabs (10 tabs · Context Expansion)
19. `python.org/dev/peps/pep-0681` — *PEP 681 – Data Class Transforms*
20. `pydantic.dev/latest/concepts/models` — *Pydantic Models Documentation*
21. `react.dev/reference/react/useEffect` — *React Hooks API Reference*
22. `d3js.org/d3-hierarchy` — *D3 Hierarchy Documentation*
23. `tailwindcss.com/docs/customizing-colors` — *Tailwind CSS Color Customization*
24. `developer.chrome.com/docs/extensions/mv3` — *Chrome Extensions Manifest V3 Guide*
25. `learn.microsoft.com/en-us/azure/ai-services/openai` — *Azure OpenAI Structured Outputs*
26. `docs.tigerdata.com/continuous-aggregates` — *TimescaleDB Continuous Aggregates Guide*
27. `news.ycombinator.com` — *Hacker News Frontpage* (Distraction, &lt; 8s dwell)
28. `google.com/search?q=where+to+store+refresh+tokens` — *Google Search Query*

---

## 2. Timed Live Demo Narration (0:00 – 2:45)

### [0:00 – 0:30] The Problem & The Hollow Promise
> *"Every developer knows this tab nightmare: Maya has 28 tabs open. She's researching backend authentication for her project, preparing her hackathon submission, and looking at internships.*
> 
> *Standard tab managers save a graveyard of URLs. But URLs only tell you where you went—they don't remember why.*
> 
> *Notice on Maya's screen: She has Chase Bank and 1Password open. In TabForest, our on-device privacy layer—**The Hollow**—drops these sensitive sites immediately. The cloud sees zero URLs and zero events from them."*

---

### [0:30 – 1:15] The Living Grove & Intent Reconstruction
> *"Now Maya clicks **Grow Grove**. Watch what happens in under 4 seconds:*
> 
> *The leaves swirl into clusters, trunks grow, and canopies fill. Notice that every visual element encodes real data:*
> - *The large green tree represents **Backend Authentication**. Its thick trunk represents **42 minutes of active attention** recorded in **Tiger Data TimescaleDB continuous aggregates**.*
> - *The amber tree on the right is **Summer 2027 Internships**—its golden leaves show it's been dormant for 3 days.*
> - *At the edge, we have an emerging **Sprout** on Timescale Vector indexing, and random tabs like Spotify rest in the **Wildflower Meadow** without cluttering our goal."*

---

### [1:15 – 1:55] Mushrooms, Stones & Subterranean Evidence Roots
> *"Look at the base of the Backend Auth tree:*
> - *Here is a **Mushroom**: Maya repeatedly searched 'where to store refresh tokens' across StackOverflow and Google without settling on an answer. TabForest flagged this open loop as an unresolved question.*
> - *Here is a **Carved Stone**: 'Not using OAuth providers for v1'. It's solid because it was stated in Maya's user notes.*
> - *Here is a **Mossy Stone**: 'JWT appears preferred'. It's mossy because **Azure OpenAI Structured Outputs** inferred it from her 14-minute dwell time.*
> 
> *When Maya clicks the goal, look below ground: **The subterranean roots light up**, pinpointing the exact official FastAPI docs and JWT specifications that prove this conclusion."*

---

### [1:55 – 2:25] Save $\rightarrow$ Close $\rightarrow$ Resume with Honesty
> *"Now the magic test: Maya needs to switch tasks. She clicks **Save Context** and closes all 28 tabs. She can even quit Chrome completely.*
> 
> *When she reopens TabForest and clicks **Resume**, look at what happens: It doesn't dump 28 tabs back on her. It presents her **Resume Card** with her decisions, the single next action to take, and restores **only the 4 essential tabs**, discarding the duplicate articles and distraction tabs.*
> 
> *Maya is back in flow in under 5 seconds."*

---

### [2:25 – 2:45] Work Context Mode & Conclusion
> *"Finally, in **Work Context Mode**, Maya pastes a messy architecture transcript. TabForest extracts key decisions with **verbatim verified quotes** and generates an instant executive handoff brief.*
> 
> *TabForest transforms browser noise into living intelligence—grounded in Azure AI and powered by Tiger Data memory. Thank you!"*

---

## 3. Judge Q&A Cheat Sheet (Key Answers)

| Question / Topic | Concise Answer |
|---|---|
| **"How does it avoid hallucinating goals?"** | "We use Azure OpenAI with strict Structured Outputs (`json_schema`). Crucially, our backend server validates every claim against factual evidence. Unverified claims are automatically downgraded to hypotheses and rendered inside fog." |
| **"How is Tiger Data utilized?"** | "We use TimescaleDB hypertables with 1-day chunks for raw browser events, continuous aggregates (`tab_attention_15m`) to measure dwell time and query-time intent switches, and pgvector with DiskANN indexing for instant research memory retrieval." |
| **"What leaves the user's browser?"** | "Full URLs stay strictly on device in local storage. Only sanitized domains, locally redacted titles, and dwell timestamps pass to the backend. The Hollow drops sensitive sites entirely on the client." |
| **"Why not just use Chrome Tab Groups or OneTab?"** | "Tab groups and OneTab are manual flat URL lists. TabForest clusters by cognitive goal, reconstructs your direction, detects your unresolved questions, and lets you resume with only the tabs that matter." |
