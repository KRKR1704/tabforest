// Offline, duplicate resend and incognito: events queue while the API is down and arrive exactly once when it is back. Stand-in API on port 8001 (the extension's default).
import { chromium } from 'playwright';
import http from 'node:http'; import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
const EXT = path.resolve(process.env.EXT);
const ORIGIN = 'chrome-extension://nldemblgfgcaolkpkajdbefjfnileeoi';
const check = (n, ok, d = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const stored = new Map(); let duplicates = 0;
const api = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Dev-User', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    if (req.url !== '/api/events') { res.writeHead(404, cors); return res.end(); }
    let accepted = 0, dup = 0;
    for (const e of JSON.parse(body).events) { if (stored.has(e.event_id)) dup++; else { stored.set(e.event_id, e); accepted++; } }
    duplicates += dup; res.writeHead(202, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify({ accepted, duplicates: dup }));
  });
});
const pages = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<!doctype html><title>Page ${req.url}</title><h1>x</h1>`); });
await new Promise(r => pages.listen(0, '127.0.0.1', r)); const port = pages.address().port;

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-lc-')), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
await sleep(1000);
await sw.evaluate(() => chrome.storage.local.set({ dev_user_id: '11111111-2222-5333-8444-555555555555' }));
const hub = await ctx.newPage(); await hub.goto(`chrome-extension://${new URL(sw.url()).host}/grove.html`); await sleep(300);
const queued = () => hub.evaluate(async () => { const q = (await chrome.storage.local.get('tf_event_queue')).tf_event_queue; return Array.isArray(q) ? q.length : (q?.events?.length ?? 0); });

// 1. offline: the API is not listening yet
for (const p of ['/a', '/b']) { const pg = await ctx.newPage(); await pg.goto(`http://localhost:${port}${p}`); await sleep(400); }
await sleep(600);
const offlineQueued = await queued();
check('offline: events stay in the local queue', offlineQueued >= 4, `${offlineQueued} queued`);
check('offline: nothing was lost or sent', stored.size === 0);

// 2. (A real worker restart cannot be forced from Playwright; tests/lifecycle.test.mjs covers rehydration and
//    the manual checklist covers Chrome's "Stop" button. The queue lives in chrome.storage.local, checked next.)

// 3. the API comes back; a flush delivers each event once, a resend of the same batch is all duplicates
await new Promise(r => api.listen(8001, '127.0.0.1', r));
await sleep(300);
const receipt = await sw.evaluate(() => self.flushNow());
check('back online: the queued events are delivered', stored.size >= offlineQueued && receipt?.accepted >= offlineQueued, JSON.stringify(receipt));
check('back online: the queue is empty after the 202', (await queued()) === 0, `${await queued()} left`);
const again = await sw.evaluate(() => self.resendLastBatch());
check('duplicate resend: the same batch is accepted as duplicates only', again?.accepted === 0 && again?.duplicates === receipt.accepted + receipt.duplicates, JSON.stringify(again));
check('duplicate resend: the server still holds each event once', stored.size === receipt.accepted, `${stored.size} stored, ${duplicates} duplicates seen`);

// 4. incognito is not allowed for this extension
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
check('incognito: manifest blocks the extension in private windows', manifest.incognito === 'not_allowed', manifest.incognito);
const allowed = await sw.evaluate(() => chrome.extension.isAllowedIncognitoAccess());
check('incognito: Chrome reports no incognito access', allowed === false, String(allowed));
await ctx.close(); api.close(); pages.close();
