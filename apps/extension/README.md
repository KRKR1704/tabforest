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

## Sign-in (D-6)

`SIGN_IN` (from the Grove page, or `await signIn()` in the service worker console) opens a small window with an email and password form and a "Sign in with Microsoft" button. The token is kept in `chrome.storage.session` and used as `Authorization: Bearer` for `POST /api/events`. `SIGN_OUT` clears the token and anything waiting to be sent.

- The email login needs the API to run with `FALLBACK_LOGIN=true` and an account in `FALLBACK_ACCOUNTS`; the deployed API answers 404 for it while the flag is off.
- Microsoft sign-in uses client ID `84bf8d79-85c2-463d-a8eb-c0a4d22bdb24` (public) and the redirect URI `https://<extension id>.chromiumapp.org/`, which must be registered for the app. Override with `VITE_ENTRA_CLIENT_ID`, `VITE_ENTRA_TENANT`, `VITE_ENTRA_SCOPE` at build time.

