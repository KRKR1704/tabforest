import { chromium } from 'playwright';
import http from 'node:http'; import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
const EXT = path.resolve(process.env.EXT);
const ORIGIN = 'chrome-extension://nldemblgfgcaolkpkajdbefjfnileeoi';
const results = []; const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- a stand-in for P's API: 401 without X-Dev-User, idempotent insert, outage switch ----
const stored = new Map(); const requests = []; let down = false;
const api = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Dev-User', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const reply = (s, o, extra = {}) => { res.writeHead(s, { 'content-type': 'application/json', ...cors, ...extra }); res.end(JSON.stringify(o)); };
    if (req.url === '/health') return reply(200, { status: 'ok' });
    if (req.url !== '/api/events' || req.method !== 'POST') return reply(404, {});
    const dev = req.headers['x-dev-user'];
    requests.push({ dev: dev ?? null, auth: req.headers.authorization ?? null, n: 0, status: 0 });
    const rec = requests.at(-1);
    if (down) { rec.status = 503; return reply(503, { title: 'Service Unavailable' }, { 'Retry-After': '1' }); }
    if (!dev) { rec.status = 401; return reply(401, { title: 'Unauthorized' }); }
    let events; try { events = JSON.parse(body).events; } catch { rec.status = 422; return reply(422, {}); }
    if (!Array.isArray(events) || events.length < 1 || events.length > 500) { rec.status = 422; return reply(422, {}); }
    let accepted = 0, duplicates = 0;
    for (const e of events) { if (stored.has(e.event_id)) duplicates++; else { stored.set(e.event_id, e); accepted++; } }
    rec.n = events.length; rec.status = 202; reply(202, { accepted, duplicates });
  });
});
await new Promise(r => api.listen(8001, '127.0.0.1', r));

const pages = http.createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0]; const p = req.url.split('?')[0];
  const title = host === 'chase.com' ? 'Chase Bank balance 123456789012' : p === '/secret' ? 'Order for jane.doe@example.com key a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4' : `Page ${p}`;
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<!doctype html><title>${title}</title><h1>x</h1>`);
});
await new Promise(r => pages.listen(0, '127.0.0.1', r)); const port = pages.address().port;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-e2e-'));
const context = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--host-resolver-rules=MAP chase.com 127.0.0.1'] });
let [sw] = context.serviceWorkers(); if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 }); await sleep(1000);
const preview = () => sw.evaluate(() => self.sendPreview());
const visit = async url => { const pg = await context.newPage(); await pg.goto(url).catch(() => {}); await sleep(1000); return pg; };

// A. browse with NO credentials: server answers 401, nothing may be lost
await visit(`http://localhost:${port}/one`); await visit(`http://localhost:${port}/secret`); await visit(`http://chase.com:${port}/`); await visit(`http://localhost:${port}/two`);
const manualNoCred = await sw.evaluate(() => self.flushNow());
const pA = await preview();
check('without credentials the API answers 401 and every event stays in the queue', requests.some(r => r.status === 401) && pA.pending_count > 0 && manualNoCred === null, `pending ${pA.pending_count}, 401s ${requests.filter(r => r.status === 401).length}`);
const idsBefore = new Set((await sw.evaluate(async () => (await chrome.storage.local.get('tf_event_queue')).tf_event_queue.events.map(e => e.event_id))));

// B. set the dev user (like the smoke test) and flush by hand: must work even after earlier 401s
await sw.evaluate(() => chrome.storage.local.set({ dev_user_id: '2c39c3a9-ed08-5c01-af50-52b4ae25ebc3' }));
const r1 = await sw.evaluate(() => self.flushNow());
const pB = await preview();
check('after dev_user_id is set, a manual flush sends everything (401 no longer blocks)', r1 && r1.accepted === idsBefore.size && r1.duplicates === 0 && pB.pending_count === 0, JSON.stringify(r1));
check('server received exactly the queued event_ids, no more, no fewer', stored.size === idsBefore.size && [...idsBefore].every(id => stored.has(id)));
check('request carried the X-Dev-User header', requests.some(r => r.status === 202 && r.dev === '2c39c3a9-ed08-5c01-af50-52b4ae25ebc3'));

// C. what actually left the device
const sent = [...stored.values()]; const json = JSON.stringify(sent);
check('no URL, no query, no banking host in anything sent', !/https?:\/\//.test(json) && !/chase/i.test(json) && !/localhost:\d+/.test(json));
check('titles redacted (email and token gone) in what was sent', !/jane\.doe/.test(json) && !/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4/.test(json) && sent.some(e => (e.title ?? '').includes('[redacted]')));
const keys = { OPEN: ['domain','dup_key','event_id','opener_tab_ref','search_query','tab_ref','title','ts','type'], UPDATE: ['domain','dup_key','event_id','search_query','tab_ref','title','ts','type'], FOCUS: ['event_id','previous_tab_ref','tab_ref','ts','type'], BLUR: ['active_ms','event_id','tab_ref','ts','type'], CLOSE: ['event_id','tab_ref','ts','type'], IDLE: ['event_id','tab_ref','ts','type'], ACTIVE: ['event_id','tab_ref','ts','type'] };
check("every sent event has exactly the fields of P's contract (the API would 422 on extras)", sent.every(e => JSON.stringify(Object.keys(e).sort()) === JSON.stringify(keys[e.type])));
check('every OPEN comes before other events of its tab (per tab_ref)', (() => { const first = new Map(); for (const e of sent) if (!first.has(e.tab_ref)) first.set(e.tab_ref, e.type); return [...first.entries()].every(([ref, t]) => t === 'OPEN' || !sent.some(e => e.type === 'OPEN' && e.tab_ref === ref)); })());

// D. forced resend: identical batch again -> all duplicates, nothing new
const before = stored.size;
const r2 = await sw.evaluate(() => self.resendLastBatch());
check('resendLastBatch(): same batch again gives accepted 0 and duplicates = batch size', r2 && r2.accepted === 0 && r2.duplicates === idsBefore.size, JSON.stringify(r2));
check('server row count unchanged after the resend', stored.size === before);

// E. outage: 503 keeps events; recovery sends the SAME event_ids once
down = true;
await visit(`http://localhost:${port}/three`); await visit(`http://localhost:${port}/four`);
const queuedIds = await sw.evaluate(async () => (await chrome.storage.local.get('tf_event_queue')).tf_event_queue.events.map(e => e.event_id));
const rDown = await sw.evaluate(() => self.flushNow());
check('during an outage (503) the events stay queued and nothing is lost', rDown === null && queuedIds.length > 0 && queuedIds.every(id => !stored.has(id)), `${queuedIds.length} queued`);
down = false;
const rUp = await sw.evaluate(() => self.flushNow());
check('after recovery the same queued event_ids arrive exactly once', rUp && rUp.accepted === queuedIds.length && rUp.duplicates === 0 && queuedIds.every(id => stored.has(id)), JSON.stringify(rUp));
const pEnd = await preview();
check('queue is empty at the end and the preview shows no titles or tab refs', pEnd.pending_count === 0 && !JSON.stringify(pEnd).match(/title|tab_ref/));
console.log('\nrequests by status:', JSON.stringify(requests.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {})), '| unique events stored:', stored.size);
console.log('SUMMARY:', results.filter(Boolean).length, 'passed,', results.filter(x => !x).length, 'failed');
await context.close(); api.close(); pages.close(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(results.includes(false) ? 1 : 0);
