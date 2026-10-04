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

## Grove UI inside the extension (D-11)

The Grove page (`apps/grove`, Shriya) is its own Vite app. To put it inside the extension as `grove.html`:

```sh
cd apps/grove && npm ci && npm run build        # builds dist/ and checks it is extension-safe
cd ../extension && pnpm build:with-grove        # vite build, then copies the Grove build into dist/
```

`pnpm bundle:grove` runs only the copy step (after `pnpm build`). The script copies `apps/grove/dist/index.html` to `dist/grove.html` and the Grove `assets/` next to the extension's own (sourcemaps are not copied). It refuses a Grove build with inline or remote scripts, a page that points at a missing file, and a file name that already exists in the extension with different content. If `apps/grove/dist` does not exist, the placeholder `grove.html` stays. No Grove code is edited.

## Sign-in (D-6)

`SIGN_IN` (from the Grove page, or `await signIn()` in the service worker console) opens a small window with an email and password form and a "Sign in with Microsoft" button. The token is kept in `chrome.storage.session` and used as `Authorization: Bearer` for `POST /api/events`. `SIGN_OUT` clears the token and anything waiting to be sent.

- The email login needs the API to run with `FALLBACK_LOGIN=true` and an account in `FALLBACK_ACCOUNTS`; the deployed API answers 404 for it while the flag is off.
- Microsoft sign-in uses client ID `84bf8d79-85c2-463d-a8eb-c0a4d22bdb24` (public) and the redirect URI `https://<extension id>.chromiumapp.org/`, which must be registered for the app. Override with `VITE_ENTRA_CLIENT_ID`, `VITE_ENTRA_TENANT`, `VITE_ENTRA_SCOPE` at build time.

## Work Context (D-9)

Right-click a page (or selected text) and choose **Add page to Work Context**. The icon shows ✓ when it worked and ! when the page is private, paused or cannot be read. Items stay on this device in `chrome.storage.local` (`tf_work_items`, newest 20, 12,000 characters each) and the Grove reads them with `GET_WORK_ITEMS`; `CLEAR_WORK_ITEMS` removes them. The page text is read only after the click, through `activeTab`, and never includes form fields, editable regions, scripts or hidden elements.

## Restore (D-8)

`RESTORE` reopens the chosen tabs from the local URL store (kept in `chrome.storage.local`, so it works after Chrome restarts), else from `fallback_urls`, and puts them in a named tab group when the optional `tabGroups` permission is granted. The first click on a Restore/Resume/Open button in the Grove asks for that permission (`public/tf-permissions.js`); if it is declined, plain tabs open.
