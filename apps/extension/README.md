# TabForest extension scaffold (D-1)

Run from `apps/extension/` with Node 20:

```sh
PATH="/opt/homebrew/opt/node@20/bin:$PATH" pnpm install
PATH="/opt/homebrew/opt/node@20/bin:$PATH" pnpm test
PATH="/opt/homebrew/opt/node@20/bin:$PATH" pnpm typecheck
PATH="/opt/homebrew/opt/node@20/bin:$PATH" pnpm build
PATH="/opt/homebrew/opt/node@20/bin:$PATH" pnpm dev
PATH="/opt/homebrew/opt/node@20/bin:$PATH" pnpm mock
```

After a successful production build, open `chrome://extensions`, enable
Developer mode, choose **Load unpacked**, and select `apps/extension/dist`.
The ID must be `nldemblgfgcaolkpkajdbefjfnileeoi`. Click TabForest in the
Extensions menu (or pin and click its toolbar icon): `grove.html` should show
“TabForest grove placeholder” and the same ID. Chrome verification is manual.

The mock listens on `127.0.0.1:8001`. It accepts the `batch_request` shape from
`contracts/events.example.json`, retains seen event IDs in memory until restart,
and returns `{accepted, duplicates}`. It rejects batches over 500 events,
missing event IDs, and `user_id` anywhere in the body. `ALLOWED_EXTENSION_ORIGIN`
overrides the default fixed extension origin for CORS. Stop with Ctrl+C.

Only the toolbar listener and placeholder are implemented. The preflight probe
remains separate in `preflight/`.
