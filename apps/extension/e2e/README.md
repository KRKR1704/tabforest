# Real-Chromium checks (D-15)

These start a real Chromium with the built extension loaded, drive it through the service worker and the Grove page, and print `PASS` / `FAIL` lines. They use Playwright and local stand-in servers; nothing here reaches the deployed API except `cors.mjs`.

They are **not** run by `pnpm test` (that is the fast unit suite). Run them before a demo and after any change to `src/background/`.

```sh
cd apps/extension && pnpm build            # or pnpm build:zip, then unzip
cd e2e && npm install && npx playwright install chromium
EXT=../dist node hollow.mjs                # Node 20; EXT is the folder with manifest.json
```

| Script | Checks | Notes |
|---|---|---|
| `hollow.mjs` | Private sites, login pages, redaction, no events from them | 13 checks |
| `open.mjs` | OPEN for every tab, blank tab, opener refs | 6 |
| `sync.mjs` | Batches, idempotent resend, offline, 401, 422, Retry-After | needs port 8001 free, 13 |
| `bridge.mjs` | All bridge messages from the Grove page | 15 |
| `signin.mjs` | Sign-in window, Bearer token, sign-out clears the queue | port 8001, `SHOT=/tmp/x.png`, 15 |
| `grove.mjs` | The Grove loads inside the extension on the real bridge | needs the Grove bundled (`pnpm build:zip`), `SHOT=/tmp/x.png` |
| `workctx.mjs` | Work Context privacy (no inputs, hidden text, scripts), Hollow first | variant build: `node variant.mjs ../dist /tmp/wc --host "http://localhost/*"`, 14 |
| `restore.mjs` | RESTORE after quitting and reopening Chrome | plain build: no group. Variant `--tabgroups` plus `EXPECT_GROUP=1`: grouped, 5 |
| `lifecycle.mjs` | Offline queueing, delivery after the API returns, duplicate resend, incognito blocked | port 8001, 8 |
| `privacy.mjs` | Pause/exclude sync, 404 keeps waiting, read back, WIPE_LOCAL | port 8001, 11 |
| `cors.mjs` | Deployed API answers the extension origin | needs the network |

The ID of the loaded extension must be `nldemblgfgcaolkpkajdbefjfnileeoi` (the scripts that talk to stand-in APIs rely on the CORS origin). Not covered because Playwright cannot do it: pressing the `tabGroups` permission prompt, the real right-click menu, Microsoft sign-in.

The whole product in one run (browse, sign in, events, grow, save/restore, prune, Work Context, privacy, delete, with the real model on a throwaway Postgres) is in `full-stack/`; see its README.
