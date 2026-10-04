# Extension test checklist (D-15)

Run this before the demo and after any change under `apps/extension/src/background/`. "Automated" items have a check you can re-run (unit suite: `cd apps/extension && pnpm test`; real Chromium: `apps/extension/e2e/`, see its README). "Manual" items need a person because Chrome only shows the dialog or menu to a human.

Last full run: 2026-10-04, build from `main` plus PRs D-8 and D-10 (unit 206 of 206).

## 1. Capture and the Hollow

| # | Check | How | Status |
|---|---|---|---|
| 1 | Ordinary page produces OPEN, UPDATE, FOCUS, BLUR, CLOSE with a random `tab_ref` | `e2e/open.mjs`, `tests/capture.test.mjs` | Automated, green |
| 2 | Banking, personal email, health portal, password manager: no event at all | `e2e/hollow.mjs` (13) | Automated, green |
| 3 | `/login`, `/signin`, `/oauth`, `/auth` paths: no event | `e2e/hollow.mjs` | Automated, green |
| 4 | Titles: email, long digits, tokens, URLs become `[redacted]`; a title that is only an address is not sent | `e2e/hollow.mjs`, `tests/hollow.test.mjs` | Automated, green |
| 5 | Pause stops capture at once; resume restarts it | `tests/hollow.test.mjs`, `e2e/privacy.mjs` | Automated, green |
| 6 | Exclude a domain: next page on that domain (and subdomains) produces nothing | `tests/bridge.test.mjs`, `e2e/privacy.mjs` | Automated, green |
| 7 | Incognito: extension has no access in a private window | `e2e/lifecycle.mjs` (manifest `not_allowed`, `isAllowedIncognitoAccess() === false`) | Automated, green |
| 7b | Incognito, by eye: open a private window, browse; the Grove count and the send preview do not change | Chrome, one minute | **Manual** |
| 8 | Restricted pages (`chrome://`, Web Store, `about:blank`, PDF viewer): no event, Work Context refuses with the red ! | `e2e/workctx.mjs`, `tests/work-context.test.mjs` | Automated, green (PDF and the real Web Store: **manual** once) |

## 2. Queue, sending, offline

| # | Check | How | Status |
|---|---|---|---|
| 9 | API down: events wait in the local queue, nothing lost | `e2e/lifecycle.mjs` | Automated, green |
| 10 | API back: queued events delivered once, queue empties after the 202 | `e2e/lifecycle.mjs`, `e2e/sync.mjs` | Automated, green |
| 11 | Duplicate resend (`resendLastBatch()`): server answers all duplicates, holds each event once | `e2e/lifecycle.mjs`, `e2e/sync.mjs` | Automated, green |
| 12 | 401 stops hammering and waits for sign-in; 422 drops the batch; 429/503 honor Retry-After | `tests/sync.test.mjs`, `e2e/sync.mjs` | Automated, green |
| 13 | **Worker restart**: stop the service worker, the queue and capture state are still there | `tests/lifecycle.test.mjs` (rehydration), Chrome cannot be told to stop it from a script | Unit green; **manual**: `chrome://extensions` → TabForest → "service worker" → DevTools → Application → Service workers → **Stop**, then use the Grove: tabs and the queue are intact |
| 14 | "What we send" preview shows exactly the next batch | `e2e/bridge.mjs` (`GET_SEND_PREVIEW`), `tests/bridge.test.mjs` | Automated, green |

## 3. Sign-in and the cloud

| # | Check | How | Status |
|---|---|---|---|
| 15 | Fallback login: wrong password message, right password signs in, token only in session storage, Bearer on the next send | `e2e/signin.mjs` (15) | Automated, green against a stand-in. Deployed API: login is off (`FALLBACK_LOGIN`), P to turn it on |
| 16 | Microsoft sign-in, deployed API: `/api/me` answers 200 with the token | Done once by hand on 2026-10-03 | **Manual**, repeat on the demo profile |
| 17 | Sign-out clears token, queue, last batch; capture keeps queueing locally | `e2e/signin.mjs` | Automated, green |
| 18 | Events reach the deployed API for the signed-in user, rows in the database | P runs the SQL; the extension side was checked on 2026-10-03 (8 accepted) | **Manual** with P |
| 19 | CORS: the deployed API answers the extension origin only | `e2e/cors.mjs` | Automated, needs the network |
| 20 | Privacy sync: pause and exclusions reach `PATCH /api/privacy`; read back after sign-in | `e2e/privacy.mjs` (stand-in) | Automated green. Deployed endpoint: not there yet (P-10), **manual** after P deploys |

## 4. Grove, restore, Work Context

| # | Check | How | Status |
|---|---|---|---|
| 21 | The Grove opens inside the extension on the real bridge, no CSP errors, no failed requests | `e2e/grove.mjs` (needs `pnpm build:zip` or `build:with-grove`) | Automated, green |
| 22 | Restore reopens tabs, also **after quitting and reopening Chrome** | `e2e/restore.mjs` | Automated, green |
| 23 | Restore into a named group; permission prompt appears on the first "Restore ..." click; declining gives plain tabs | `e2e/restore.mjs` with the `--tabgroups` variant covers the grouping; the prompt itself | Grouping automated; the prompt **manual** |
| 24 | **Chrome restart → sign in → resume**: quit Chrome, reopen, sign in, open a saved context, Restore: the tabs open | `e2e/restore.mjs` (restart + restore) plus the sign-in check above | Automated halves green; the whole path once **manual** on the demo profile |
| 25 | Right-click "Add page to Work Context" shows the green ✓; a private site shows the red ! | `e2e/workctx.mjs` calls the same code; the real right-click | Code automated; the click **manual** |
| 26 | Work Context text never contains form fields, editable areas, hidden text, scripts | `e2e/workctx.mjs`, `tests/work-context.test.mjs` | Automated, green |
| 27 | Delete all (`WIPE_LOCAL`): local storage has no queue, URLs, work items, settings | `e2e/privacy.mjs` | Automated, green |

## 5. Release hygiene

| # | Check | How | Status |
|---|---|---|---|
| 28 | Zip has the right ID key, approved permissions, no host permissions, no sourcemaps, the real Grove, the deployed API address | `pnpm build:zip` refuses otherwise; `tests/build-zip.test.mjs` | Automated, green |
| 29 | Extension ID is `nldemblgfgcaolkpkajdbefjfnileeoi` after "Load unpacked" | `chrome://extensions` | **Manual**, 5 seconds |
| 30 | Console of the service worker and of the Grove page: no red errors during a full run | DevTools | **Manual** |

## Known gaps this checklist found

- A real service-worker stop cannot be forced from a script (item 13): covered by unit tests plus the manual step.
- The Grove asks Google Fonts for a stylesheet each time it opens (`apps/grove/index.html`), a request to a third party that `docs/privacy.md` does not mention; Shriya to bundle the fonts or accept it.
- Restored tabs may appear in reverse order in the tab strip (Chrome places background tabs next to the active one).
- Hollow categories cannot be edited from the Grove and an exclusion cannot be removed (no bridge message).
