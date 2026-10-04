// Live check: a visible Chromium with the real extension against the DEPLOYED API.
// You sign in once (Microsoft, in the window that opens); everything after that is automatic: real sites and real
// searches, grow, tree detail, save/resume/restore, prune, timeline, Work Context (paste and upload), Ask Memory, privacy.
// It never deletes anything (no "Delete forest", no "Delete all"). It creates real events and a real grove for the account
// that signs in, and one excluded domain (example-live-check.invalid).
//
//   EXT=<live build folder> node live-check.mjs        (see README.md: build with VITE_MOCK=0 and the deployed API address)
//   env: API_BASE (default https://tabforest.azurewebsites.net), OUT (report folder), LOGIN_WAIT_MIN (default 8),
//        TOPIC_GAP_MIN (minutes to wait between topics while browsing, default 0; use 4 to get separate trees)
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { chromium } from 'playwright';

const EXT = path.resolve(process.env.EXT);
const API = (process.env.API_BASE || 'https://tabforest.azurewebsites.net').replace(/\/$/, '');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = process.env.OUT || path.join(os.homedir(), 'Desktop', 'Hackathons', 'GirlHacks2026_Oct03', `live-check-${stamp}`);
const DOCS = process.env.SAMPLE_DOCS || path.resolve(import.meta.dirname, '../../../api/app/engine/fixtures/sample_docs');
const LOGIN_WAIT_MS = Number(process.env.LOGIN_WAIT_MIN || 8) * 60_000;
const TOPIC_GAP_MS = Number(process.env.TOPIC_GAP_MIN || 0) * 60_000;
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const results = []; const known = []; const bad = []; const consoleErrors = [];
async function step(name, fn) {
  const t0 = Date.now();
  try { const detail = await fn(); results.push({ name, ok: true, ms: Date.now() - t0, detail: detail ?? '' }); log('PASS', name, detail ?? ''); }
  catch (e) { results.push({ name, ok: false, ms: Date.now() - t0, detail: String(e.message ?? e).slice(0, 400) }); log('FAIL', name, '->', String(e.message ?? e).slice(0, 300)); await shot(`fail-${results.length}`).catch(() => {}); }
}
const note = (what) => { known.push(what); log('KNOWN', what); };
const ok = (cond, msg) => { if (!cond) throw new Error(msg); return msg.startsWith('!') ? '' : undefined; };

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-live-')), {
  channel: 'chromium', headless: false, viewport: null,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1400,900', '--no-first-run'],
});
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
await sleep(1200);
const extId = new URL(sw.url()).host;
const grove = await ctx.newPage();
grove.on('response', r => { if (r.status() >= 400 && r.url().startsWith(API)) bad.push(`${r.request().method()} ${r.status()} ${new URL(r.url()).pathname}`); });
grove.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
grove.on('pageerror', e => consoleErrors.push('PAGEERROR ' + String(e).slice(0, 200)));
const growTimes = [];
grove.on('requestfinished', async r => { if (r.url().includes('/api/grove/grow')) { const t = r.timing(); growTimes.push(Math.round(t.responseEnd)); } });
await grove.goto(`chrome-extension://${extId}/grove.html`); await sleep(1500);

async function shot(name) { await grove.screenshot({ path: path.join(OUT, `${String(results.length).padStart(2, '0')}-${name}.png`), fullPage: true }); }
const nav = async (label) => { await grove.bringToFront(); await grove.getByRole('button', { name: new RegExp('^' + label) }).or(grove.getByRole('link', { name: new RegExp('^' + label) })).first().click(); await sleep(1800); };
const mainText = async () => (await grove.innerText('main').catch(() => grove.innerText('body'))).replace(/\n+/g, ' | ');
const waitFor = async (fn, tries, ms) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const api = (method, p, body) => grove.evaluate(async ([method, p, body, API]) => {
  const t = (await chrome.runtime.sendMessage({ type: 'GET_TOKEN' })).data.token;
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}, [method, p, body, API]);
const bridge = (msg) => grove.evaluate(m => chrome.runtime.sendMessage(m), msg);

// ---- 1. sign in (the only step that needs you)
await step('the Grove opens inside the extension and asks for sign-in', async () => {
  ok(/Sign in with Microsoft/.test(await grove.innerText('body')), 'no sign-in screen');
});
log('==> ACTION NEEDED: sign in with Microsoft in the browser window that is about to open. Waiting up to', LOGIN_WAIT_MS / 60000, 'minutes.');
const popupPromise = ctx.waitForEvent('page', { timeout: 20000 }).catch(() => null);
await grove.getByRole('button', { name: /Sign in with Microsoft/ }).click();
const popup = await popupPromise;
if (popup) { await popup.waitForLoadState().catch(() => {}); await popup.click('#microsoft').catch(() => {}); }
const signedIn = await waitFor(async () => { const s = await bridge({ type: 'GET_AUTH_STATE' }).catch(() => null); return s?.ok && s.data?.signed_in ? s.data : null; }, Math.ceil(LOGIN_WAIT_MS / 2000), 2000);
await step('Microsoft sign-in completed', async () => { ok(!!signedIn, 'not signed in within the wait time'); return signedIn.display_name ? `signed in as ${signedIn.display_name}` : 'signed in'; });
if (!signedIn) { fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ results, known }, null, 2)); await ctx.close(); process.exit(1); }
await sleep(2000);

// ---- 2. a real browsing session: real sites, real searches, tab switching, one private site
const SITES = [
  ['auth', 'https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/'],
  ['auth', 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Authentication'],
  ['auth', 'https://en.wikipedia.org/wiki/JSON_Web_Token'],
  ['auth', 'https://en.wikipedia.org/wiki/OAuth'],
  ['auth-search', 'https://html.duckduckgo.com/html/?q=where+to+store+refresh+token'],
  ['auth-search', 'https://html.duckduckgo.com/html/?q=refresh+token+httponly+cookie+vs+localstorage'],
  ['auth-search', 'https://html.duckduckgo.com/html/?q=is+it+safe+to+keep+refresh+token+in+the+browser'],
  ['food', 'https://en.wikipedia.org/wiki/Chickpea'],
  ['food', 'https://en.wikipedia.org/wiki/Curry'],
  ['food', 'https://en.wikipedia.org/wiki/Hummus'],
  ['travel', 'https://en.wikipedia.org/wiki/Lisbon'],
  ['travel', 'https://en.wikipedia.org/wiki/Portugal'],
];
const pages = [];
// Attention counts only while the computer is in use (Chrome's idle state, 60 s): a run where nobody touches the mouse or
// keyboard for the 2-3 minutes of browsing reads 0 minutes. Sample the idle state so that case is reported as such.
const idleSamples = [];
const idleTimer = setInterval(async () => { idleSamples.push(await sw.evaluate(() => new Promise(r => chrome.idle.queryState(60, r))).catch(() => '?')); }, 8000);
log('==> KEEP USING THE COMPUTER for the next 3 minutes (move the mouse now and then): time spent counts only while it is in use.');
await step('browse 12 real pages and 3 searches with dwell and switching', async () => {
  let lastTopic = null;
  for (const [topic, url] of SITES) {
    const group = topic.split('-')[0];
    if (TOPIC_GAP_MS && lastTopic && group !== lastTopic) { log(`waiting ${TOPIC_GAP_MS / 60000} min before the next topic`); await sleep(TOPIC_GAP_MS); }
    lastTopic = group;
    const p = await ctx.newPage(); pages.push({ topic, p, url });
    await p.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {});
    await p.mouse.wheel(0, 700).catch(() => {}); await sleep(9000);
  }
  for (const i of [0, 4, 1, 7, 0, 5, 2]) { await pages[i].p.bringToFront(); await sleep(6000); }
  ok(pages.length === SITES.length, 'not all pages opened');
  return `${pages.length} tabs, titles: ${(await Promise.all(pages.slice(0, 4).map(x => x.p.title().catch(() => '')))).map(t => t.slice(0, 28)).join(' | ')}`;
});
await step('a private sign-in page is skipped by the Hollow', async () => {
  const p = await ctx.newPage(); await p.goto('https://accounts.google.com/signin', { timeout: 30000, waitUntil: 'domcontentloaded' }).catch(() => {}); await sleep(5000);
  await grove.bringToFront(); await sleep(1500);
  const count = (await bridge({ type: 'GET_HOLLOW_COUNT' })).data.count;
  const preview = JSON.stringify((await bridge({ type: 'GET_SEND_PREVIEW' })).data);
  ok(count >= 1, `hollow count ${count}`); ok(!/accounts\.google\.com/.test(preview), 'the private domain is in the send preview');
  await p.close(); return `hollow count ${count}`;
});
await step('events reach the live API', async () => {
  await sw.evaluate(() => self.flushNow()).catch(() => {}); await sleep(4000);
  const me = await api('GET', '/api/me'); ok(me.status === 200, `GET /api/me ${me.status}`);
  const sess = await api('GET', '/api/sessions'); ok(sess.status === 200, `GET /api/sessions ${sess.status}`);
  return `sessions: ${JSON.stringify(sess.json).slice(0, 120)}`;
});

// ---- 3. grow
let growth = null;
await step('Grow grove: the live API returns a grove from the real model', async () => {
  await nav('Current Grove');
  const before = (await api('GET', '/api/grove')).json?.run_id ?? null;
  const t0 = Date.now();
  await grove.getByRole('button', { name: /Grow grove/ }).click();
  growth = await waitFor(async () => { const r = await api('GET', '/api/grove'); return r.status === 200 && r.json.run_id !== before ? r.json : null; }, 45, 3000);
  ok(!!growth, 'no new grove stored within 2 minutes');
  await sleep(2000); await shot('grown');
  const trees = growth.trees.map(t => `${t.name} (${t.branches.flatMap(b => b.leaves).length} tabs, ${t.attention_min} min, ${t.goal.provenance})`);
  ok(growth.degraded === false, `degraded: ${growth.banner_text}`);
  ok(growth.trees.length >= 2, `only ${growth.trees.length} tree(s): ${trees.join(' / ')}`);
  return `${Math.round((Date.now() - t0) / 1000)} s; ${trees.join(' | ')}`;
});
await step('the Grove shows no "AI unavailable" or "unreachable" banner', async () => {
  const body = await grove.innerText('body');
  ok(!/AI unavailable|unreachable|Showing sample data/.test(body), body.match(/AI unavailable[^\n]*|The grove service[^\n]*|Showing sample data[^\n]*/)?.[0] ?? 'banner');
});
clearInterval(idleTimer);
const idleSeen = idleSamples.filter(state => state !== 'active').length;
await step('attention minutes are real (the engine reads the stored events)', async () => {
  if (growth && !growth.trees.some(t => t.attention_min > 0) && idleSeen > 0) {
    note(`attention read 0 min because the computer was idle in ${idleSeen} of ${idleSamples.length} samples while browsing; run it again and keep using the mouse`);
    return `0m, computer idle (${idleSeen}/${idleSamples.length} samples)`;
  }
  ok(growth && growth.trees.some(t => t.attention_min > 0), growth ? growth.trees.map(t => t.attention_min).join(',') : 'no grove');
  return growth.trees.map(t => `${t.attention_min}m`).join(' ');
});
if (growth && !growth.trees.some(t => t.mushrooms.length)) note('no open question was found in this short session (the 3 refresh-token searches may not count as a loop in 2 minutes)');

// ---- 4. tree detail, save, resume, restore
await step('tree detail opens with goal and direction', async () => {
  await grove.evaluate(() => document.querySelector('[data-select-kind="tree"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))); await sleep(1500);
  const d = await grove.locator('[aria-label="Tree detail"]').first().innerText({ timeout: 10000 });
  ok(/GOAL/.test(d) && /DIRECTION/.test(d), d.slice(0, 100)); await shot('tree-detail');
});
await step('Save context stores a resume point', async () => {
  await grove.getByRole('button', { name: /Save context/ }).click(); await sleep(3000);
  const c = await api('GET', '/api/contexts'); ok(c.status === 200 && (c.json.contexts?.length ?? 0) >= 1, `contexts ${c.status}`);
  return `${c.json.contexts.length} saved`;
});
await step('Timeline shows attention and tab switches', async () => {
  await nav('Timeline'); const t = await mainText(); await shot('timeline');
  const minutes = growth ? growth.trees.reduce((a, x) => a + x.attention_min, 0) : 0;
  if (/Nothing recorded/.test(t) && minutes < 5) { note(`Timeline is empty with only ${minutes} min of attention in total (very short dwell); run a longer session (TOPIC_GAP_MIN=4) to check it`); return 'empty (short session)'; }
  ok(/min of attention/.test(t), t.slice(0, 160)); return t.slice(0, 120);
});
await step('Saved Groves: resume card, then Restore reopens closed tabs (waits up to 25 s for the group prompt)', async () => {
  await nav('Saved Groves');
  for (const x of pages.filter(x => x.topic.startsWith('auth')).slice(0, 4)) await x.p.close().catch(() => {});
  await sleep(1000); await grove.bringToFront();
  await grove.getByRole('button', { name: /Resume/ }).first().click(); await sleep(3500); await shot('resume-card');
  const text = await mainText(); ok(/Restore \d+ important tabs|Restore all/.test(text), 'no restore buttons: ' + text.slice(0, 120));
  const before = ctx.pages().length;
  log('(if Chrome asks to allow tab groups, you can click Allow or just wait)');
  await grove.getByRole('button', { name: /^Restore/ }).first().click();
  const after = await waitFor(async () => (ctx.pages().length > before ? ctx.pages().length : 0), 14, 2000);
  ok(!!after, `no tabs reopened (${before} pages)`); return `${before} -> ${after} pages`;
});

// ---- 5. prune
await step('prune suggestions answer in the contract shape and the dialog opens', async () => {
  await nav('Current Grove');
  const refs = growth.trees.flatMap(t => t.branches.flatMap(b => b.leaves.map(l => l.tab_ref))).slice(0, 60);
  const pr = await api('POST', '/api/tabs/prune-suggestions', { tab_refs: refs });
  ok(pr.status === 200 && Array.isArray(pr.json?.suggestions) && pr.json.actions?.length === 4, `prune ${pr.status}`);
  await grove.getByRole('button', { name: /Review tabs to prune/ }).click(); await sleep(3000); await shot('prune');
  ok(/prune|Keep all|Close selected|Nothing to prune/i.test(await grove.innerText('body')), 'no prune dialog');
  await grove.keyboard.press('Escape'); await sleep(500);
  return `${pr.json.suggestions.length} suggestion(s): ${pr.json.suggestions.map(s => s.kind).join(', ') || 'none'}`;
});

// ---- 6. Work Context (paste and upload) with the real model
await step('Work Context: pasted note plus uploaded files give a sourced result', async () => {
  await nav('Work Context');
  await grove.getByPlaceholder(/What is this/).fill('Jira CAM-142');
  await grove.getByPlaceholder(/Meeting notes or a chat excerpt/).fill(fs.readFileSync(path.join(DOCS, 'jira-CAM-142.md'), 'utf8').slice(0, 11000));
  await grove.setInputFiles('input[type=file]', [path.join(DOCS, 'teams-transcript.vtt'), path.join(DOCS, 'pr-418.md')]);
  const t0 = Date.now();
  await grove.getByRole('button', { name: /Reconstruct/ }).click();
  const text = await waitFor(async () => { const t = await mainText(); return /handoff brief/i.test(t) ? t : null; }, 45, 2000);
  await shot('work-context');
  ok(!!text, 'no result within 90 s: ' + (await mainText()).slice(-200));
  ok(/Functions/.test(text) && /00:14:32/.test(text), 'the Azure Functions decision with its transcript time is missing');
  ok(/credential/i.test(text), 'the credentials blocker is missing');
  return `${Math.round((Date.now() - t0) / 1000)} s`;
});

// ---- 7. Ask Memory (R-12), privacy
await step('Ask Memory answers or reports that the endpoint is missing', async () => {
  await nav('Ask Memory'); await grove.getByRole('textbox').first().fill('session storage'); await grove.keyboard.press('Enter'); await sleep(3500);
  const t = await mainText(); await shot('ask-memory');
  if (/could not be searched/.test(t)) note('Ask Memory: GET /api/memory/search does not exist on the live API yet (R-12)'); else ok(t.length > 0, 'empty');
});
await step('Privacy: pause for 1 hour, exclude a site, then resume', async () => {
  await nav('Privacy');
  await grove.getByRole('button', { name: /Pause for 1 hour/ }).click(); await sleep(3000);
  let p = (await api('GET', '/api/privacy')).json; ok(!!p.paused_until && p.paused_until < '9999', 'pause not stored: ' + JSON.stringify(p.paused_until));
  await grove.getByLabel(/Site to exclude/).fill('example-live-check.invalid'); await grove.getByRole('button', { name: /Exclude site/ }).click(); await sleep(3000);
  p = (await api('GET', '/api/privacy')).json; ok(p.excluded_domains.includes('example-live-check.invalid'), 'exclusion not stored');
  const resume = grove.getByRole('button', { name: /Resume capture|^Resume$|Stop pause/i }).first();
  if (await resume.count()) { await resume.click(); await sleep(2500); } else await api('PATCH', '/api/privacy', { paused_until: null });
  p = (await api('GET', '/api/privacy')).json; ok(p.paused_until === null, 'still paused'); await shot('privacy');
});
await step('the extension stayed responsive and capture continued after privacy changes', async () => {
  const s = await bridge({ type: 'GET_SEND_PREVIEW' }); ok(s.ok, 'send preview failed');
});

// ---- report
if (bad.some(x => /POST 401 \/api\/grove\/grow/.test(x))) note('the Grove tried to grow before sign-in (401) and does not retry after sign-in: sample data is shown until Grow grove is clicked');
const unexpected = bad.filter(x => !/memory\/search|GET 404 \/api\/grove|POST 401 \/api\/grove\/grow/.test(x));
await step('no unexpected 4xx/5xx answers from the API during the run', async () => { ok(unexpected.length === 0, unexpected.join(' | ')); });
const failed = results.filter(r => !r.ok);
const report = { when: new Date().toISOString(), api: API, results, known, unexpected, consoleErrors: consoleErrors.slice(0, 10), growResponseMs: growTimes };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(OUT, 'report.md'), `# Live check ${report.when}\n\nAPI: ${API}\n\n| Step | Result | Seconds | Detail |\n|---|---|---|---|\n${results.map(r => `| ${r.name} | ${r.ok ? 'PASS' : '**FAIL**'} | ${(r.ms / 1000).toFixed(1)} | ${String(r.detail).replace(/\|/g, '/').slice(0, 200)} |`).join('\n')}\n\n## Known gaps\n${known.map(k => `- ${k}`).join('\n') || '- none'}\n\n## Console errors\n${consoleErrors.slice(0, 10).map(e => `- ${e}`).join('\n') || '- none'}\n`);
log(`SUMMARY: ${results.length - failed.length} passed, ${failed.length} failed. Report: ${OUT}`);
await ctx.close();
process.exit(failed.length ? 1 : 0);
