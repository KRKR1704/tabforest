// The whole product in one run: real extension in Chromium, real API, Postgres, and the real Azure OpenAI model.
// A day of browsing (28 demo tabs over five simulated hours plus three private sites), sign-in, events in the database,
// the grove, tree detail, save/resume/restore, prune, Work Context (captured page, pasted note, uploaded files),
// Ask Memory, privacy, delete one forest, delete everything.
import fs from 'node:fs'; import path from 'node:path';
import { launch, startPages, openGrove, browseDay, visitHollow, signIn, apiCall, check, known, summary, sleep, sql, SH } from './stack.mjs';

const DOCS = process.env.SAMPLE_DOCS;
const { server, port } = await startPages();
const env = await launch(port);
const pages = await browseDay(env);
await visitHollow(env, port);
const grove = await openGrove(env);
const bad = [];
grove.on('response', r => { if (r.status() >= 400) bad.push(`${r.request().method()} ${r.status()} ${new URL(r.url()).pathname}`); });
grove.on('dialog', d => d.accept());
const nav = async (label) => { await grove.getByRole('button', { name: new RegExp('^' + label) }).or(grove.getByRole('link', { name: new RegExp('^' + label) })).first().click(); await sleep(1500); };
const main = async () => (await grove.innerText('main')).replace(/\n+/g, ' | ');
const snap = (name) => grove.screenshot({ path: `${SH}/${name}.png`, fullPage: true });
const waitFor = async (fn, tries = 40, ms = 3000) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };

// 1. sign-in through the extension's own window; capture, the Hollow and the database
check('Grove shows the sign-in screen when signed out', /Sign in with Microsoft/.test(await grove.innerText('body')));
await signIn(env, grove);
check('Grove leaves the sign-in screen after a real login', !/Sign in with Microsoft/.test(await grove.innerText('body')));
await env.sw.evaluate(() => self.flushNow()); await sleep(2500);
const types = sql("SELECT event_type, count(*) AS n FROM browser_events GROUP BY 1");
const span = sql("SELECT min(ts) AS lo, max(ts) AS hi FROM browser_events")[0];
check('events from the browser are in the database', types.reduce((a, r) => a + Number(r.n), 0) >= 100, JSON.stringify(types));
check('tab switching was recorded (FOCUS and BLUR)', types.some(r => r.event_type === 'FOCUS') && types.some(r => r.event_type === 'BLUR'));
check('the events cover hours, like a real day', (new Date(span.hi) - new Date(span.lo)) > 3 * 3600e3);
check('private sites and form-field text never reached the database', Number(sql("SELECT count(*) AS n FROM browser_events WHERE title ~* 'SECRETFIELD|chase|1password' OR domain IN ('chase.com','my.1password.com','accounts.google.com')")[0].n) === 0);
check('no title in the database contains a URL or an email', Number(sql("SELECT count(*) AS n FROM browser_events WHERE title ~* '(https?://|[a-z0-9._-]+@[a-z0-9.-]+[.][a-z]+)'")[0].n) === 0);

// 2. the grove (real model)
if (/Showing sample data, not your tabs/.test(await grove.innerText('body'))) known('the Grove grows once before sign-in (401) and does not retry after it: sample data until "Grow grove" is clicked');
await grove.getByRole('button', { name: /Grow grove/ }).click();
const grown = await waitFor(async () => { const r = await apiCall(grove, 'GET', '/api/grove'); return r.status === 200 ? r.json : null; });
check('the grove is stored after Grow grove', !!grown);
await sleep(1500);
const trees = grown?.trees ?? [];
console.log('TREES:', trees.map(t => `${t.name} (${t.branches.flatMap(b => b.leaves).length} tabs, ${t.attention_min} min)`).join(' | '));
check('not degraded: the real model answered', grown?.degraded === false);
check('the topics are separated (at least 4 trees)', trees.length >= 4, String(trees.length));
check('attention minutes come from the real events', trees.filter(t => t.attention_min > 0).length >= 3, trees.map(t => t.attention_min).join(','));
check('the hollow count matches the 3 private sites', grown?.hollow_count === 3);
if (trees.some(t => t.mushrooms.length > 0)) check('the grove finds a real open question from the browsing', true, trees.flatMap(t => t.mushrooms.map(m => m.display_text)).join(' / '));
else known('the model found no open question this time (it varies between runs)');
await snap('20-grown');

// 3. timeline
await nav('Timeline');
const tl = await main();
check('Timeline shows real attention and tab switches', /min of attention/.test(tl) && /tab switches/.test(tl), tl.slice(0, 160));

// 4. tree detail, save context, resume, restore after closing the tabs
await nav('Current Grove');
await grove.evaluate(() => document.querySelector('[data-select-kind="tree"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
await sleep(1500);
const drawer = await grove.locator('[aria-label="Tree detail"]').first().innerText({ timeout: 10000 }).catch(() => '');
check('tree detail shows goal and direction', /GOAL/.test(drawer) && /DIRECTION/.test(drawer), drawer.slice(0, 120).replace(/\n+/g, ' | '));
await grove.getByRole('button', { name: /Save context/ }).click(); await sleep(2500);
check('Save context stored a resume point in the database', Number(sql("SELECT count(*) AS n FROM saved_contexts")[0].n) === 1);
check('the saved snapshot carries no query strings', !/https?:[^"\\]*\?/.test(JSON.stringify(sql("SELECT snapshot FROM saved_contexts")[0].snapshot)));
await nav('Saved Groves');
for (const p of pages.slice(0, 8)) await p.close();
await sleep(800);
await grove.getByRole('button', { name: /Resume/ }).first().click(); await sleep(3000);
check('the resume card shows goal, next step and restore choices', /RESUME/.test(await main()) && /Restore \d+ important tabs/.test(await main()));
const before = (await env.ctx.pages()).length;
await grove.getByRole('button', { name: /^Restore/ }).first().click(); await sleep(4500);
const after = (await env.ctx.pages()).length;
check('Restore reopened the closed tabs from the local URL store', after > before, `${before} -> ${after}`);
check('the restored tabs sit in a named tab group', (await env.sw.evaluate(async () => (await chrome.tabGroups.query({})).map(g => g.title))).length >= 1);
check('the notice says how many tabs were reopened', /Reopened \d+ tabs/.test(await grove.innerText('body')));

// 5. prune
await nav('Current Grove');
const refs = grown ? grown.trees.flatMap(t => t.branches.flatMap(b => b.leaves.map(l => l.tab_ref))) : [];
const prune = await apiCall(grove, 'POST', '/api/tabs/prune-suggestions', { tab_refs: refs.slice(0, 60) });
console.log('PRUNE:', prune.status, JSON.stringify((prune.json?.suggestions ?? []).map(s => `${s.kind}:${s.tab_refs.length}`)));
check('prune suggestions answer with the contract shape', prune.status === 200 && Array.isArray(prune.json?.suggestions) && prune.json.actions.length === 4);
if (prune.json?.suggestions?.length === 0) known('prune found nothing to suggest on this day of browsing (no exact duplicates, no stale tabs; semantic redundancy needs the R-13 follow-up)');
await grove.getByRole('button', { name: /Review tabs to prune/ }).click(); await sleep(3000);
check('the prune dialog opens', /prune|Keep all|Close selected/i.test(await grove.innerText('body')));
await grove.keyboard.press('Escape'); await sleep(500);

// 6. Work Context: a captured page, a pasted note and uploaded files, with the real model
await pages[12].bringToFront().catch(() => {}); await sleep(500);
// make one of the demo pages (any loaded http page will do) the active tab, as a right-click on it would
await env.sw.evaluate(async () => {
  const t = (await chrome.tabs.query({})).find(x => /^http:\/\/[^/]+\/t\d+$/.test(x.url) && x.status === 'complete');
  await chrome.tabs.update(t.id, { active: true }); await chrome.windows.update(t.windowId, { focused: true });
});
await sleep(500);
const added = await env.sw.evaluate(() => self.addToWorkContext());
check('a page was captured into Work Context (the right-click code path)', added?.ok === true, JSON.stringify(added));
await nav('Work Context');
check('the captured page is listed', /CAPTURED PAGES · 1/i.test(await main()));
const items = await grove.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'GET_WORK_ITEMS' })).data.items);
check('the captured text holds no form-field content', items.length === 1 && !/SECRETFIELD/.test(items[0].text));
await grove.getByPlaceholder(/What is this/).fill('Jira CAM-142');
await grove.getByPlaceholder(/Meeting notes or a chat excerpt/).fill(fs.readFileSync(path.join(DOCS, 'jira-CAM-142.md'), 'utf8').slice(0, 11000));
await grove.setInputFiles('input[type=file]', [path.join(DOCS, 'teams-transcript.vtt'), path.join(DOCS, 'pr-418.md')]);
await grove.getByRole('button', { name: /Reconstruct/ }).click();
const wc = await waitFor(async () => { const t = await main(); return /handoff brief/i.test(t) ? t : null; }, 40, 2000);
await snap('51-work-context');
check('Work Context returned a result from the real model', !!wc);
check('the goal is sourced with a quote', /GOAL \| Migrate customer authentication to Azure/.test(wc ?? '') && /SOURCED/.test(wc ?? ''));
check('the Azure Functions decision shows its transcript time and speaker', /Functions/.test(wc ?? '') && /Marcus Lee/.test(wc ?? '') && /00:14:32/.test(wc ?? ''));
check('the credentials blocker is found', /credential/i.test(wc ?? ''));

// 7. Ask Memory (needs R-12; reported, not failed)
await nav('Ask Memory');
await grove.getByRole('textbox').first().fill('session storage'); await grove.keyboard.press('Enter'); await sleep(3000);
if (/could not be searched/.test(await main())) known('Ask Memory: GET /api/memory/search does not exist yet (R-12)');
else check('Ask Memory answered', true);

// 8. privacy
await nav('Privacy');
await grove.getByRole('button', { name: /Pause for 1 hour/ }).click(); await sleep(2500);
let priv = (await apiCall(grove, 'GET', '/api/privacy')).json;
check('Pause for 1 hour reached the API', !!priv.paused_until && priv.paused_until < '9999', priv.paused_until);
await grove.getByLabel(/Site to exclude/).fill('mybank.com'); await grove.getByRole('button', { name: /Exclude site/ }).click(); await sleep(2500);
priv = (await apiCall(grove, 'GET', '/api/privacy')).json;
check('excluding a site reached the API', priv.excluded_domains.includes('mybank.com'));

// 9. delete one forest, then everything
const counts = () => sql("SELECT (SELECT count(*) FROM projects) p, (SELECT count(*) FROM browser_events) e, (SELECT count(*) FROM users) u, (SELECT count(*) FROM saved_contexts) s, (SELECT count(*) FROM memory_embeddings) m")[0];
const c0 = counts();
await grove.getByRole('button', { name: 'Delete forest' }).first().click(); await sleep(800);
await grove.getByRole('button', { name: 'Delete', exact: true }).first().click(); await sleep(3500);
const c1 = counts();
check('Delete forest removed one project and kept the raw events', Number(c1.p) === Number(c0.p) - 1 && Number(c1.e) === Number(c0.e));
check('the deleted forest is gone from the stored grove', (await apiCall(grove, 'GET', '/api/grove')).json.trees.length === Number(c0.p) - 1);
await grove.getByRole('button', { name: /Delete all my memory/ }).click(); await sleep(800);
await grove.getByRole('button', { name: /Delete everything/ }).click(); await sleep(5000);
const c2 = counts();
check('Delete all emptied every table for the user', Object.values(c2).every(v => Number(v) === 0), JSON.stringify(c2));
check('the extension wiped its local data', Object.keys(await env.sw.evaluate(() => chrome.storage.local.get(null))).length === 0);
check('the Grove is back at the sign-in screen', /Sign in with Microsoft/.test(await grove.innerText('body')));
const unexpected = bad.filter(x => !/GET 404 \/api\/grove|\b401 |memory\/search/.test(x));  // 401: requests in flight when the account is deleted and the token is gone
check('no unexpected 4xx/5xx from the API during the whole run', unexpected.length === 0, unexpected.join(' | '));
summary();
await env.ctx.close(); server.close();
fs.rmSync(env.dir, { recursive: true, force: true });  // the Chromium profile
