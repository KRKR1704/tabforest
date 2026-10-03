# TabForest networking preflight (throwaway)

Plain JS/HTML; no dependencies or build step. No permissions, host permissions,
or content scripts. This is only the PRE-D2 networking probe.

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**,
   and select this `apps/extension/preflight/` folder.
2. Check the extension card's ID equals `nldemblgfgcaolkpkajdbefjfnileeoi`
   from `../EXTENSION_KEY.md`. Click this extension in Chrome's Extensions menu
   to open the preflight page. Its displayed ID must match too.
3. On the extension card, click the **service worker** link under **Inspect views**
   to open its DevTools; select **Console** and keep it open.
4. Paste P's deployed HTTPS API base URL into the preflight page, without `/health`.
   Click **Fetch from page**, then **Fetch from service worker**.
5. Both page results should show `HTTP 200` and `{"status":"ok"}`. In the worker
   DevTools Console, expand `TabForest preflight /health:` to see `status: 200`
   and the response body. Take screenshots of the page (including the extension
   ID and both results) and the expanded worker Console result for PRE-D2.

The probe appends `/health`, tolerates a trailing slash, and rejects non-HTTPS
bases, credentials, query strings and fragments. HTTP failures show their actual
status and body; fetch failures show the browser's error message. Response text
is rendered with `textContent`.

A CORS error means P must check that the API allow-list includes the exact origin
`chrome-extension://nldemblgfgcaolkpkajdbefjfnileeoi` and returns the matching CORS
header. A generic `Failed to fetch` alone does not prove CORS: inspect the page's
DevTools Console or worker Console for CORS, TLS, DNS, or connection errors.
Do not add host permissions to bypass a failure.

Live verification needs P's deployed `/health` endpoint and CORS configuration.
Chrome execution, ID matching and live HTTP 200 responses have not been verified
by the coding agent; Deep must perform the steps above.
