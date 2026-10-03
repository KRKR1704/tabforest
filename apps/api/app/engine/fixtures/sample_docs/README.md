SAMPLE — fictional data for the TabForest demo. Contoso Ltd. is a fictional company.

# SAMPLE enterprise documents (PRE-R2)

Fictional work artifacts for TabForest's Work Context Mode (TabForest_Proposal.md §6 and §21; BUILD_TASKS.md PRE-R2, R-11). Contoso Ltd., Fabrikam, Inc. and every person named here (Priya Shah, Marcus Lee, Dana Ortiz, Sam Rivera, Jordan Blake) are invented. "You" is the demo user.

| File | What it is |
|---|---|
| `jira-CAM-142.md` | Jira ticket CAM-142 "Customer Authentication Migration": goal, acceptance criteria, sub-tasks, comments. The OAuth callback work (CAM-145) is assigned to You. |
| `pr-418.md` | GitHub PR #418 "Token service on Azure Functions (WIP)" with review thread. Blocker: customer test credentials. Unanswered question on session state. |
| `teams-transcript.vtt` | WebVTT Teams transcript of the 2026-09-22 arch sync (~23 min, 51 cues). Decision at 00:14:32: "we'll go with Functions". Session state raised twice, never answered. |
| `migration-doc.md` | "Customer Auth Migration Plan" §1–§6. §4 Cutover and rollback is the section the next action points to. Session storage is TBD. |
| `customer-note.md` | Dana Ortiz's account note on Fabrikam: Nov 3 timeline, promised test credentials, contact, unrelated renewal noise. |
| `EXPECTED.json` | Answer key for R-11 tests: goal, decision, blocker, owners, open question, ranked next actions, each with a verbatim quote. |

Each file is under 12,000 characters (R-11's per-item cap) and starts with the SAMPLE banner (the `.vtt` carries it in a `NOTE` block after the required `WEBVTT` header).

## Who uses them

- **R (R-11):** fixtures for the Work Context extractor and its tests; `EXPECTED.json` is the answer key.
- **P (P-15):** renders these documents as the SAMPLE enterprise pages at `/demo/*` on the API.
- **D (D-9):** the demo captures those `/demo/*` pages through the "Add page to Work Context" context menu.

P and D copy the files into their own folders; this folder is owned by R. Check them with:

```
apps\api\.venv\Scripts\python apps\api\app\engine\scripts\check_sample_docs.py
```
