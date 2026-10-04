# Full-stack run

One script drives the whole product the way a person would: the real extension in Chromium browses the 28 demo tabs over
five simulated hours plus three private sites, signs in through the extension's own window, sends events to the real API
and a real Postgres, grows the grove with the real Azure OpenAI model, opens a tree, saves/resumes/restores, prunes,
uses Work Context (captured page, pasted note, uploaded files), privacy, and deletes one forest and then everything.
About 40 checks, 4 to 5 minutes, a few thousand model tokens.

Nothing touches a shared database: `harness.py` starts a throwaway Postgres 16 with pgvector, loads the repo's migrations
without the TimescaleDB-only statements, and deletes it afterwards. The real Azure model is used when the usual
`AZURE_OPENAI_*` variables are set in the environment (never put them in a file).

```sh
# once
cd apps/grove && npm ci && VITE_MOCK=0 VITE_API_BASE_URL=http://127.0.0.1:8001 npm run build
cd ../extension && pnpm build:with-grove
node e2e/full-stack/prepare-build.mjs dist /tmp/tf-full-stack-build
cd e2e && npm install && npx playwright install chromium

# every run (Node 20, uv; AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_CHAT_DEPLOYMENT,
# AZURE_OPENAI_EMBED_DEPLOYMENT, AZURE_OPENAI_API_VERSION exported)
cd full-stack
EXT=/tmp/tf-full-stack-build uv run --with pgserver --with asyncpg python harness.py \
    ../../../../db/migrations ./run-full-stack.sh full-flow.mjs
```

`prepare-build.mjs` explains the two changes it makes in a copy of the build (a movable clock for the service worker, and
permissions headless Chromium cannot grant). Screenshots go to `$TMPDIR/tabforest-full-stack-shots`; the API log to
`$TMPDIR/tabforest-full-stack-api.log`. Lines starting with `KNOWN` are gaps reported, not failures.

---

# Live check (against the deployed API)

`live-check.mjs` opens a **visible** Chromium with the real extension and runs the product against the **deployed** API
(`https://tabforest.azurewebsites.net`) and the real Azure OpenAI model behind it. You sign in with Microsoft once, in the window
that opens; everything after that is automatic: 12 real pages and 3 real searches with tab switching, a private sign-in page
(must be skipped by the Hollow), Grow grove, tree detail, Save context, Resume and Restore, Timeline, prune, Work Context (paste
and upload), Ask Memory, privacy (pause, exclude a site, resume). It takes about 8 to 10 minutes and writes a report with a
screenshot of every screen.

It **never deletes anything** (no "Delete forest", no "Delete all"). It creates real events and one real grove for the account that
signs in, and one excluded domain (`example-live-check.invalid`) that the Grove cannot remove afterwards. Use a test account if

Keep using the computer (move the mouse now and then) while it browses, about 3 minutes: attention is counted only while Chrome sees the computer in use (idle after 60 s without input). If nobody touches it, every tree reads 0 minutes; the script samples the idle state and reports that as a note instead of a failure.
you care about a clean history.

## What you need

- A computer with a screen (the browser is visible; it cannot run headless or over plain SSH). macOS or Linux with a desktop.
- Node 20, pnpm 10 (`npm i -g pnpm@10`) and npm. Python is not needed for this check.
- A Microsoft account that is allowed to sign in to TabForest (the team's Entra app accepts work, school and personal accounts).
- Internet access, and the deployed API up (`curl https://tabforest.azurewebsites.net/health` answers 200).

## One-time setup (from the repository root)

```sh
# 1. Playwright and its Chromium (the e2e folder has its own package.json; nothing is added to the extension)
cd apps/extension/e2e && npm install && npx playwright install chromium && cd ../../..

# 2. The extension build that talks to the deployed API, with the live Grove inside it
cd apps/grove && npm ci && VITE_MOCK=0 VITE_API_BASE_URL=https://tabforest.azurewebsites.net npm run build && cd ../..
cd apps/extension && pnpm install && VITE_API_BASE=https://tabforest.azurewebsites.net pnpm build:with-grove && cd ../..
# BOTH bundles must mention the deployed address (the extension's own default is the local mock, 127.0.0.1:8001):
grep -l "tabforest.azurewebsites.net" apps/extension/dist/assets/*.js    # expect two files: the service worker and the Grove
```

(`pnpm build:zip` sets the deployed address itself and runs extra safety checks; it needs the Grove build from step 2 first.)

## Run

```sh
cd apps/extension/e2e/full-stack
EXT="$(cd ../../dist && pwd)" node live-check.mjs
```

1. A Chromium window opens. A TabForest sign-in window and then a Microsoft page appear. **Sign in yourself** (password, MFA).
   The script waits up to `LOGIN_WAIT_MIN` minutes (default 8).
2. When the Grove shows you signed in, **do not touch the window.** The script browses, clicks and checks for 8 to 10 minutes.
   Chrome may ask to allow tab groups during Restore: click Allow, or ignore it (the script carries on after 15 seconds).
3. At the end it prints `SUMMARY: N passed, M failed` and the report folder:
   `~/Desktop/Hackathons/GirlHacks2026_Oct03/live-check-<time>/` by default, or the folder in `OUT`.
   It contains `report.md`, `report.json` and the screenshots.

Options (environment variables): `API_BASE` (another deployment), `OUT` (report folder), `LOGIN_WAIT_MIN`, `SAMPLE_DOCS`, and
`TOPIC_GAP_MIN`: minutes to wait between topics while browsing. The default (0) opens every page within about 2.5 minutes, which
makes the clustering merge the topics into one tree (the engine rewards tabs opened close together). `TOPIC_GAP_MIN=4` waits four
minutes between topics (about 25 minutes in total) and should give separate trees.

## Reading the result

- A `FAIL` line is a real problem. A `KNOWN` line is a gap we already know about (for example Ask Memory needs `R-12`, and the Grove
  grows once before sign-in and does not retry). Known gaps do not fail the run.
- The most telling checks: "Grow grove ... real model" (not degraded; if the Grove says "AI unavailable" the Azure OpenAI
  settings are missing on the App Service), "attention minutes are real", "Restore reopens closed tabs", "Work Context ... sourced".
- With the default pacing, one tree is expected, not a failure of the product's AI: see `TOPIC_GAP_MIN`.

## Troubleshooting

- *No window appears*: Playwright's Chromium is not installed (`npx playwright install chromium`), or there is no display.
- *The sign-in window opens but Microsoft never appears*: click "Sign in with Microsoft" in the small TabForest window once.
- *"not signed in within the wait time"*: raise `LOGIN_WAIT_MIN`; the token also expires after about an hour, so do not pause in the middle.
- *DuckDuckGo shows a challenge page*: the three search tabs lose their query titles; the run still passes, but the open-question
  check becomes meaningless. Rerun later or from another network.
- *Anything under `chrome://` or another extension's page cannot be driven*: the script only drives TabForest's own pages and web pages.

## For an AI agent running this for someone

1. Read this section, then run the one-time setup commands exactly as written; do not skip the grep that checks the build mentions the
   deployed address. If a command fails, report the exact error and stop.
2. Tell the person, in plain words, that a browser window will open and that **they** must sign in with Microsoft there, and that they must
   not touch it afterwards. Never type or ask for their password, MFA code or any credential; never write one to a file.
3. Start the script in the background (`node live-check.mjs > live-check.out 2>&1`) so you can keep talking, and poll `live-check.out`.
   A line `==> ACTION NEEDED: sign in` means the person must act now.
4. Do not run anything that deletes data and do not edit the script to add deletion. Do not run it against a different `API_BASE`
   unless asked.
5. When it ends, read `report.md` and the screenshots (the Grove screens are images). Report: what passed, every `FAIL` with its detail,
   every `KNOWN` line, and what a human should look at. Distinguish a product problem from a test-shape problem (for example one tree
   because of the default pacing). Do not "fix" a failing check by loosening it.
