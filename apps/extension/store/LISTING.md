# Chrome Web Store listing: TabForest

Everything to paste into the developer dashboard (Store listing, Privacy practices, Distribution). Files to upload are in this folder. Updated 2026-10-04.

## Package

Build the file to upload from `apps/extension/` (Node 20, the Grove built with `VITE_MOCK=0`):

```
cd apps/grove && npm ci && VITE_MOCK=0 VITE_API_BASE_URL=https://tabforest.azurewebsites.net npm run build
cd ../extension && pnpm build:store
```

The output is `tabforest-extension-<version>-store.zip`: the same code as `pnpm build:zip` without the manifest `key`, because the Web Store assigns the extension ID itself. The build refuses to produce it if an icon is missing, a permission differs from the approved list, or a host permission or source map is present.

Raise `version` in `manifest.config.ts` for every new upload.

## Store listing tab

| Field | Value |
|---|---|
| Name | TabForest |
| Summary (132 characters max) | See the goals behind your open tabs. Resume your research in one click. Private pages are never recorded. |
| Category | Productivity |
| Language | English |
| Icon (128x128) | `public/icons/icon-128.png` |
| Small promo tile (440x280) | `store/promo-tile-440x280.png` |
| Screenshots (1280x800) | the six files in `store/screenshots/`, in order. They show sample data, not a real person's browsing |
| Support URL | https://github.com/KRKR1704/tabforest/issues |
| Privacy policy URL | https://github.com/KRKR1704/tabforest/blob/main/docs/privacy.md |

### Description

Ever opened twenty tabs and forgotten why?

TabForest notices which tabs you open and how long you stay on them, and grows them into a living grove. Each tree is one goal. Each leaf is one tab. A question you keep searching for becomes a mushroom, an answered one becomes a flower, and a decision becomes a stone.

What you get
- A grove of your open tabs, grouped by the goal behind them, in plain words with a label that says how sure it is (stated, sourced, inferred or hypothesis) and the tabs it is based on.
- Resume: save a goal and come back later to see where you were, what you decided, what is still open and what to do next, then reopen the important tabs in one click.
- Tidy up: suggestions for duplicate and stale tabs. Nothing is closed until you click.
- Work Context: add a page or a few notes on purpose and get a short, sourced summary of a project.
- A timeline of how your research unfolded, and a memory you can ask: "have I researched this before?"

Your privacy comes first
- Only the site name, a cleaned-up page title and timings are recorded. Never full addresses, page contents, passwords, cookies or what you type into pages. The only words recorded are the text of searches on known search engines.
- Banking, health, personal email, password managers and sign-in pages are skipped completely, and so is Incognito.
- Pause, exclude a site, see exactly what would be sent, or delete everything, at any time.
- No tab is closed without your click.

TabForest needs a Microsoft account to sign in, so your grove is yours alone.

## Privacy practices tab

### Single purpose

TabForest helps a person understand and resume their own research: it turns the tabs they open into goals, open questions and a one-click way back to where they stopped.

### Permission justifications

| Permission | Justification to paste |
|---|---|
| `tabs` | Read the site name and title of a tab when it opens, changes or closes, and how long it is in front. This is the core signal that TabForest groups into goals. Page contents are never read. Only the site name and a cleaned title leave the computer; full addresses stay on the device. |
| `storage` | Keep the queue of events waiting to be sent, the local map that lets "restore tabs" reopen pages, the user's settings, and the sign-in token (session storage only). |
| `idle` | Stop counting active time when the user steps away from the computer. |
| `identity` | Open the Microsoft sign-in window (launchWebAuthFlow) so each person's grove is private to them. |
| `contextMenus` | The right-click item "Add page to Work Context", used only when the user chooses it. |
| `activeTab` | Granted by Chrome for one page when the user clicks "Add page to Work Context". |
| `scripting` | After that click, read the visible text of that one page, skipping form fields, editable areas, scripts and hidden elements. Never runs in the background. |
| `tabGroups` (optional) | Asked only the first time the user restores a saved goal: put the restored tabs into one named group. If declined, plain tabs open. |

Not requested: history, cookies, webRequest, webNavigation, host permissions, content scripts.

### Remote code

No. All code is in the package. The extension makes network requests only to the TabForest API (https://tabforest.azurewebsites.net) and to Microsoft's sign-in service.

### Data usage (tick these)

| Data type | Collected? | Why |
|---|---|---|
| Personally identifiable information | Yes | Name and email from the Microsoft sign-in, to show who is signed in. |
| Authentication information | Yes | The sign-in token, kept for the session. |
| Web history | Yes | Site name, cleaned page title and timings of the tabs the user opens while the extension is installed. No full addresses. |
| User activity | Yes | Which tab is in front and for how long, tab switches. |
| Website content | Yes, only on request | The text of a page or notes the user adds to Work Context and analyses. Not stored after the answer. |
| Health, financial, location, communications | No | Banking, health and email sites are skipped entirely. |

Tick all three certifications: no selling to third parties, no use unrelated to the single purpose, no use for creditworthiness or lending. The Limited Use statement is in `docs/privacy.md`.

### Test instructions for the reviewer

Put the reviewer's sign-in details in the dashboard field "Test instructions" (not in this repository), for example:

> Click the TabForest toolbar icon to open the Grove. Sign in with the test account given here (or any Microsoft account). Open three or four unrelated pages in different tabs, wait a minute, and press "Grow grove". Trees appear, one for each goal. Click a tree to see its goal and the tabs behind it. "Saved Groves" shows resume points. The right-click item "Add page to Work Context" and the "Privacy" screen can be tried at any time.

## Distribution tab

- Visibility: **Unlisted** (anyone with the link can install; not shown in search) is enough for the judges and is reviewed faster. Change to Public later if wanted.
- Regions: all. Pricing: free.

## After the store assigns the extension ID

The ID changes from the development one. Three things must then be updated with the new ID (it appears on the item's page in the dashboard):
1. `ALLOWED_EXTENSION_ORIGIN` in the API's Azure settings, to `chrome-extension://<new id>` (keep the development ID too while testing).
2. The Microsoft Entra redirect URI `https://<new id>.chromiumapp.org/`.
3. `docs/extension-test-checklist.md` and `EXTENSION_KEY.md` mention the development ID only; no change is needed there.
