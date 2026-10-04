# TabForest privacy

Owner: lane D (extension). Describes what the extension in `apps/extension/` does today; each statement can be checked in the code named next to it. Where something is planned but not built, it says so.

## In one paragraph

TabForest watches which tabs you open, switch to and close, so it can show why you opened them. It records only the site name (domain), a cleaned-up page title and timings. It never records full addresses, page contents, passwords, cookies or what you type. Private sites (banking, health, personal email, password managers, sign-in pages) and Incognito windows are never recorded at all. You can pause, exclude a site, or delete everything.

## What leaves the device

Each tab event sent to the server (`POST /api/events`, contract `contracts/events.example.json`) contains only:

| Field | What it is |
|---|---|
| `event_id`, `ts`, `type` | Random id, time, and one of OPEN, FOCUS, BLUR, UPDATE, CLOSE, IDLE, ACTIVE |
| `tab_ref`, `opener_tab_ref`, `previous_tab_ref` | Random ids made by the extension. Chrome's own tab ids are never sent |
| `domain` | Host name only, for example `github.com` |
| `title` | Page title, at most 300 characters, after redaction (below) |
| `dup_key` | A one-way hash (SHA-256) of the address with tracking parameters removed, used only to spot the same page opened twice. It cannot be turned back into the address |
| `search_query` | The text of a search, only for the known search engines (Google, Bing, DuckDuckGo, Brave, Ecosia, Yahoo) |
| `active_ms` | How long a tab was in front, with idle time taken out |

Title redaction (`src/background/hollow.ts`): web addresses, email addresses and long token-like strings are replaced by `[redacted]` before an event is even queued. A title that is just an address is not sent.

Also sent, only when you use the feature: your privacy settings (excluded domains and pause time, `PATCH /api/privacy`) and your sign-in token to prove who you are.

## What stays on the device

- Full addresses (query strings and fragments included). They are kept in `chrome.storage.local`, keyed by the random `tab_ref`, so that "restore tabs" can reopen them. They are not sent.
- Chrome's tab, window and group ids.
- The queue of events waiting to be sent (until the server confirms them).
- Work Context items (selection or page text you added by right-click): kept in `chrome.storage.local`, newest 20, at most 12,000 characters each. Today nothing sends them to the server.
- The sign-in token, in `chrome.storage.session` only (cleared when the browser closes or you sign out).

## What is never collected

Passwords, cookies, form contents, text typed into pages, card numbers, browsing history from before TabForest was installed (no `history` permission), pages visited in Incognito, and the contents of any page you did not explicitly add to Work Context. The extension has no content scripts and no host permissions; it cannot see inside pages by itself.

## The Hollow (what is skipped entirely)

A skipped tab produces no event of any kind, and the Grove shows only a count ("3 tabs are resting in the Hollow").

- Incognito: the manifest sets `incognito: not_allowed` and the worker also drops any tab marked incognito.
- Built-in categories (suffix match, so `www.chase.com` is covered): banking and payments, health portals, personal email, password managers, identity providers and university sign-in. The list is in `BUILTIN_DOMAINS` in `src/background/hollow.ts`.
- Any address whose path is `/login`, `/signin`, `/oauth` or `/auth`.
- Anything that is not http or https (`chrome://`, `file://`, extension pages, `about:blank`).
- Your own list: "never analyze this site" (`EXCLUDE_DOMAIN`), also suffix-matched.
- While paused. The check runs before anything is queued, stored or sent, and again before Work Context reads a page.

## Your controls

- Pause: for 1 hour, until tomorrow or until resumed. Synced to the server so another device honors it too.
- Exclude a domain in one click. Synced; exclusions made on another device are added here after sign-in and are never silently removed.
- See what is about to be sent (`GET_SEND_PREVIEW`), the same events the next batch will contain.
- Add to Work Context only on purpose: right-click, "Add page to Work Context". Nothing is read before that click.
- Delete all: `WIPE_LOCAL` clears everything the extension stores locally (queue, addresses, Work Context items, settings, token). Deleting the account on the server (`DELETE /api/me`) removes the cloud copy.
- Sign out: removes the token and everything waiting to be sent.

## Permissions, one by one (for the Chrome Web Store listing)

| Permission | Why | Not used for |
|---|---|---|
| `tabs` | Read the address and title of a tab when it opens, changes or closes. This is the core signal. Chrome words it as "Read your browsing history" even though TabForest sees only what is described above, only while installed, and never past history | Reading page contents, or anything before installation |
| `storage` | Event queue, local address map, settings, and the sign-in token (session storage) | Sending data anywhere |
| `idle` | Stop counting active time when you step away | Watching what you do |
| `identity` | Microsoft sign-in window (`launchWebAuthFlow`) | Reading your accounts or contacts |
| `contextMenus`, `activeTab`, `scripting` | The right-click "Add page to Work Context". Chrome grants `activeTab` for that one page only when you click; one function reads its visible text, skipping form fields, editable areas, scripts and hidden elements | Background reading of any page |
| `tabGroups` (optional, asked when first needed) | Put restored tabs into one named group | Anything else; if you decline, plain tabs open |

Not requested: `history`, `cookies`, `webRequest`, `webNavigation`, host permissions, `<all_urls>`.

## Suggested Web Store text for the "tabs" warning

> TabForest uses the tabs permission to notice when you open, switch to or close a tab, and to read that tab's site name and title. It does not read page contents, form fields, passwords or cookies, does not use your browsing history from before you installed it, and ignores banking, health, email, password-manager, sign-in and Incognito pages entirely. Full web addresses never leave your computer.

## Limited Use statement

TabForest's use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to provide and improve the features the user sees (the Grove, resume, restore, search of their own memory). It is not sold, not transferred to third parties except to run those features (the cloud services that host the TabForest API and database), not used for advertising, and not used to train models. No human reads user data unless the user asks for support and agrees.

## Known gaps (honest list)

- The Hollow's built-in categories cannot be switched off or edited from the Grove yet; there is no bridge message for it.
- An exclusion cannot be removed through the bridge, so removal is not synced.
- The API side of privacy sync (`PATCH /api/privacy`) and account deletion (`DELETE /api/me`, `DELETE /api/projects/{id}`) is implemented; until the API version that contains it is deployed, changes stay on the device and wait.
- Work Context text is not uploaded anywhere today. If analysis of it is added later, it needs its own explicit action and an update to this page.
- The data-retention and "who can read user data" statements describe the API lane's configuration; confirm with P before submitting to the Web Store.
