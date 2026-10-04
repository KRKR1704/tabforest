# Demo browser profile (D-13)

How to prepare the browser for the demo, and the checklist that it is ready. Nothing here is automated end to end: the timeline is only believable if the tabs were really browsed over the hours before, so a person does the browsing; the scripts only remove the typing.

## 1. A clean Chrome profile

1. Chrome, profile picker, **Add** a new profile (no sync, no sign-in to a Google account). Do not use a work or school profile: it contains real tabs.
2. Build the zip from the repo (needs the Grove build):
   ```sh
   cd apps/grove && npm ci && npm run build
   cd ../extension && pnpm install && pnpm build:zip
   ```
   `build:zip` refuses to zip when the extension ID key, the permission list, the Grove page or the API address is wrong, and writes `apps/extension/tabforest-extension-<version>.zip`.
3. Unzip it, open `chrome://extensions`, turn on Developer mode, **Load unpacked**, pick the unzipped folder. The ID must be `nldemblgfgcaolkpkajdbefjfnileeoi`. Pin the TabForest icon.
4. Click the icon, sign in (Microsoft account for the demo). Check: `GET_AUTH_STATE` says signed in; the events reach the API (`SELECT count(*) FROM browser_events` for the demo user, ask P).

## 2. The 28 tabs, browsed for real

Browse these over the hours before the demo, in roughly the order of the times, switching between them as a person would (the dwell and switch pattern is what the grove shows). Titles come from the shared demo set (`apps/api/app/engine/fixtures/demo_tabs.json`); open any real page on that site that matches the title. Tabs 1 and 2 are the same page opened twice on purpose. The times are UTC and only show the order and spacing.

| # | Cluster | Site | Title | Opened | Note |
|---|---|---|---|---|---|
| 1 | Backend Authentication | fastapi.tiangolo.com | OAuth2 with Password (and hashing), Bearer with JWT tokens - FastAPI | 09:41 |  |
| 2 | Backend Authentication | fastapi.tiangolo.com | OAuth2 with Password (and hashing), Bearer with JWT tokens - FastAPI | 11:03 |  |
| 3 | Backend Authentication | stackoverflow.com | JWT vs session-based authentication for a REST API - Stack Overflow | 09:48 |  |
| 4 | Backend Authentication | github.com | fastapi-jwt-auth-example: login, refresh and protected routes | 09:55 |  |
| 5 | Backend Authentication | learn.microsoft.com | OAuth 2.0 authorization code flow - Microsoft identity platform / Microsoft Learn | 10:05 |  |
| 6 | Backend Authentication | www.google.com | where to store refresh token - Google Search | 10:58 | search: where to store refresh token |
| 7 | Backend Authentication | www.google.com | refresh token httponly cookie vs localstorage - Google Search | 11:09 | search: refresh token httponly cookie vs localstorage |
| 8 | Backend Authentication | www.google.com | is it safe to keep refresh token in the browser - Google Search | 11:31 | search: is it safe to keep refresh token in the browser |
| 9 | Backend Authentication | medium.com | Securing FastAPI with JWT: a step-by-step guide / Medium | 11:00 |  |
| 10 | Backend Authentication | dev.to | FastAPI JWT authentication explained - DEV Community | 11:10 |  |
| 11 | GirlHacks Prep | girlhacks-2026.devpost.com | GirlHacks 2026 - Devpost | 08:52 |  |
| 12 | GirlHacks Prep | mlh.io | MLH Official Hackathon Rules - Major League Hacking | 08:54 |  |
| 13 | GirlHacks Prep | docs.tigerdata.com | Hypertables / Tiger Data Docs | 09:12 |  |
| 14 | GirlHacks Prep | azure.microsoft.com | Azure for Students – Free Account Credit / Microsoft Azure | 08:58 |  |
| 15 | GirlHacks Prep | d3js.org | d3-hierarchy / D3 by Observable | 09:20 |  |
| 16 | Job Search | www.linkedin.com | Backend Engineer, Platform - Northwind Traders / LinkedIn | 19:12 |  |
| 17 | Job Search | job-boards.greenhouse.io | Job Application for Software Engineer II, API at Tailspin Toys | 19:30 |  |
| 18 | Job Search | www.glassdoor.com | Tailspin Toys Software Engineer Interview Questions / Glassdoor | 19:45 |  |
| 19 | Job Search | leetcode.com | LRU Cache - LeetCode | 20:05 |  |
| 20 | Job Search | docs.google.com | Resume 2026 - Google Docs | 20:31 |  |
| 21 | Weeknight Dinner | www.allrecipes.com | One-Pan Lemon Garlic Chicken and Potatoes Recipe | 21:48 |  |
| 22 | Weeknight Dinner | www.bbcgoodfood.com | Easy chickpea curry recipe / BBC Good Food | 21:52 |  |
| 23 | Weeknight Dinner | www.instacart.com | Instacart / Grocery delivery: cart | 22:01 |  |
| 24 | Sprout | doc.rust-lang.org | What is Ownership? - The Rust Programming Language | 11:18 |  |
| 25 | Sprout | www.reddit.com | Rust vs Go for a small CLI tool? : r/rust | 11:24 |  |
| 26 | Meadow | www.youtube.com | How to fix a squeaky door hinge in 60 seconds - YouTube | 18:20 |  |
| 27 | Meadow | www.springfieldgazette.com | Library extends weekend hours starting in November - Springfield Gazette | 07:58 |  |
| 28 | Fog | pomofocus.io | Pomofocus - Pomodoro timer online | 09:39 |  |

Leave all 28 open at the end (the Grove snapshot reads open tabs).

## 3. Three Hollow sites

Visit these three and confirm the Hollow counter in the Grove goes up by 3 while no event is sent: a banking site (`chase.com/login`), a password manager (`my.1password.com`) and an account sign-in (`accounts.google.com/signin`). Check the "What we send" preview: none of them may appear. They do not need to be signed in; the page only has to load.

## 4. Sample pages into Work Context

Fictional Contoso documents. In a terminal:

```sh
node apps/extension/scripts/serve-sample-docs.mjs
```

Open `http://127.0.0.1:8765/`, open each page, right-click, **Add page to Work Context**. A green check appears on the toolbar icon. Do the five pages: `jira-CAM-142.md`, `migration-doc.md`, `pr-418.md`, `customer-note.md`, `teams-transcript.vtt`. In the Grove, Work Context shows five items. Stop the server afterwards.

## 5. Ready checklist

- [ ] Clean profile, only TabForest installed, ID `nldemblgfgcaolkpkajdbefjfnileeoi`
- [ ] Signed in; `GET_AUTH_STATE` shows the demo account
- [ ] 28 tabs open, duplicates present (1 and 2)
- [ ] Hollow count is 3 and none of the three sites appears in the send preview
- [ ] Work Context holds the five sample documents
- [ ] The API shows the events for the demo user (P confirms)
- [ ] Right-click → Add page to Work Context shows the green check (also on the day, once)
- [ ] Restore: pick a saved context, click "Restore ...", accept the tab group prompt once, tabs open in a named group
- [ ] Backup: a screen recording of the same run (R/S own the recording)

## What this does not cover

The cluster labels and the grove itself come from the engine and the API; if they look wrong, that is R's or P's lane, not the profile's.
