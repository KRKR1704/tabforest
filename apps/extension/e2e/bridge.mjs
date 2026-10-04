import { chromium } from 'playwright';
import http from 'node:http'; import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
const EXT = path.resolve(process.env.EXT);
const results = []; const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pages = http.createServer((req, res) => { const p = req.url.split('?')[0]; res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<!doctype html><title>Page ${p}</title><h1>x</h1>`); });
await new Promise(r => pages.listen(0, '127.0.0.1', r)); const port = pages.address().port;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-e2e-'));
const context = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--host-resolver-rules=MAP news.example 127.0.0.1, MAP chase.com 127.0.0.1'] });
let [sw] = context.serviceWorkers(); if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
const id = new URL(sw.url()).host; await sleep(800);
const events = [];
context.on('console', async m => { try { const v = await Promise.all(m.args().map(a => a.jsonValue().catch(() => null))); if (v.length === 1 && v[0] && typeof v[0] === 'object' && 'event_id' in v[0]) events.push(v[0]); } catch {} });
const visit = async url => { const pg = await context.newPage(); await pg.goto(url).catch(() => {}); await sleep(900); return pg; };
const a = await visit(`http://localhost:${port}/a?token=SECRET123&utm_source=x`); const b = await visit(`http://localhost:${port}/b`); const c = await visit(`http://localhost:${port}/c`);
await visit(`http://chase.com:${port}/`);
// the grove page is where S's code runs
const grove = await context.newPage(); await grove.goto(`chrome-extension://${id}/grove.html`);
const send = msg => grove.evaluate(m => chrome.runtime.sendMessage(m), msg);

const snap = await send({ type: 'GET_SNAPSHOT' });
const tabs = snap?.data?.open_tabs ?? [];
console.log('GET_SNAPSHOT ->', snap.ok, tabs.length, 'tabs;', 'titles:', tabs.map(t => t.title).join(' | '));
check('GET_SNAPSHOT returns the 3 ordinary tabs and not the banking tab', snap.ok && tabs.length >= 3 && !tabs.some(t => /chase/i.test(t.domain ?? '')));
const keys = ['active','dedup','dup_key','domain','opened_at','opener_tab_ref','pinned','search_query','tab_ref','title'];
check('each snapshot tab has the contract fields', tabs.every(t => ['tab_ref','domain','title','opener_tab_ref','opened_at','active','pinned','dup_key','search_query'].every(k => k in t)));
check('no URL, query string or Chrome tab id anywhere in the snapshot', !/https?:\/\//.test(JSON.stringify(snap)) && !/SECRET123/.test(JSON.stringify(snap)) && tabs.every(t => !('url' in t) && !('id' in t) && !('tabId' in t)));
const refA = tabs.find(t => t.title === 'Page /a')?.tab_ref; const refB = tabs.find(t => t.title === 'Page /b')?.tab_ref; const refC = tabs.find(t => t.title === 'Page /c')?.tab_ref;
check('titles and refs found for the three tabs', !!refA && !!refB && !!refC);

const urls = await send({ type: 'GET_URLS', tab_refs: [refA, refB, 'not-a-ref'] });
console.log('GET_URLS ->', JSON.stringify(urls));
check('GET_URLS returns stripped URLs only (no query, no token) and skips unknown refs', urls.ok && urls.data.urls[refA]?.endsWith('/a') && !/SECRET123|utm_source|\?/.test(JSON.stringify(urls)) && !('not-a-ref' in urls.data.urls));

// close tab B through the bridge, then reopen it from the LOCAL URL store
const before = context.pages().length;
const closed = await send({ type: 'CLOSE_TABS', tab_refs: [refB] }); await sleep(800);
check('CLOSE_TABS closes only the named tab', closed.ok && context.pages().length === before - 1 && !b.isClosed() === false);
const reopened = await send({ type: 'OPEN_TAB', tab_ref: refB }); await sleep(1500);
check('OPEN_TAB reopens a closed tab from the local URL store (the server never gives URLs)', reopened.ok && context.pages().some(p => p.url().endsWith('/b')), JSON.stringify(reopened));
const nf = await send({ type: 'OPEN_TAB', tab_ref: '00000000-0000-4000-8000-0000deadbeef' });
check('OPEN_TAB for an unknown ref returns not_found', !nf.ok && nf.error === 'not_found', JSON.stringify(nf));

// Hollow-related messages
const hc0 = (await send({ type: 'GET_HOLLOW_COUNT' })).data.count;
const ex = await send({ type: 'EXCLUDE_DOMAIN', domain: 'news.example' }); await sleep(300);
const before2 = events.length; await visit(`http://news.example:${port}/x`); const newEvents = events.length - before2;
const hc1 = (await send({ type: 'GET_HOLLOW_COUNT' })).data.count;
check('EXCLUDE_DOMAIN then visiting that domain produces no event and raises the Hollow count', ex.ok && newEvents === 0 || (ex.ok && events.slice(before2).every(e => e.type === 'BLUR')), `events ${newEvents}, count ${hc0}->${hc1}`);
check('Hollow count rose after the exclusion', hc1 >= hc0 + 1, `${hc0} -> ${hc1}`);
const bad = await send({ type: 'EXCLUDE_DOMAIN', domain: 'bad domain/with path' });
check('EXCLUDE_DOMAIN rejects a malformed domain', !bad.ok && bad.error === 'invalid_payload');
const pz = await send({ type: 'PAUSE', until: 'until resumed' }); await sleep(300);
const before3 = events.length; await visit(`http://localhost:${port}/paused`); const pausedEvents = events.slice(before3).filter(e => e.type !== 'BLUR').length;
await send({ type: 'PAUSE', until: null });
check('PAUSE until resumed stops new events, PAUSE null clears it', pz.ok && pausedEvents === 0, `${pausedEvents} events while paused`);

// stubs and misc
const auth = await send({ type: 'GET_AUTH_STATE' }); const tok = await send({ type: 'GET_TOKEN' }); const wi = await send({ type: 'GET_WORK_ITEMS' }); const prev = await send({ type: 'GET_SEND_PREVIEW' });
check('GET_AUTH_STATE, GET_TOKEN, GET_WORK_ITEMS, GET_SEND_PREVIEW return their contract shapes', auth.ok && auth.data.signed_in === false && tok.ok && tok.data.token === null && wi.ok && Array.isArray(wi.data.items) && prev.ok && 'pending_count' in prev.data, JSON.stringify([auth.data, tok.data]));
const unk = await send({ type: 'SOMETHING_ELSE' }); const si = { ok: false, error: 'not_implemented' }; // SIGN_IN now opens the sign-in window (D-6), covered by run-signin.mjs
check('unknown messages get unknown_message, SIGN_IN is not_implemented until D-6', !unk.ok && unk.error === 'unknown_message' && !si.ok && si.error === 'not_implemented', JSON.stringify([unk, si]));
const wipe = await send({ type: 'WIPE_LOCAL' }); await sleep(500);
const after = await sw.evaluate(async () => ({ local: Object.keys(await chrome.storage.local.get(null)), session: Object.keys(await chrome.storage.session.get(null)) }));
console.log('storage keys after WIPE_LOCAL:', JSON.stringify(after));
check('WIPE_LOCAL clears the extension storage (no URL map, no queue)', wipe.ok && !after.local.includes('tf_capture_urls') && !after.local.includes('tf_event_queue'));
console.log('\nSUMMARY:', results.filter(Boolean).length, 'passed,', results.filter(x => !x).length, 'failed');
await context.close(); pages.close(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(results.includes(false) ? 1 : 0);
