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
