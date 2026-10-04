import { chromium } from 'playwright';
import http from 'node:http'; import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
const EXT = path.resolve(process.env.EXT);
const ORIGIN = 'chrome-extension://nldemblgfgcaolkpkajdbefjfnileeoi';
const check = (n, ok, d = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let live = false; const patches = []; let gets = 0;
const server = { excluded_domains: ['fromserver.test'], paused_until: null };
const api = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Dev-User', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS', Vary: 'Origin' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const reply = (s, o) => { res.writeHead(s, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(o)); };
    if (req.url === '/api/privacy') {
      if (!live) return reply(404, { title: 'Not Found' });
      if (!(req.headers.authorization ?? '').startsWith('Bearer good')) return reply(401, {});
      if (req.method === 'GET') { gets++; return reply(200, server); }
      const b = JSON.parse(body); patches.push(b);
      for (const d of b.excluded_domains_add ?? []) if (!server.excluded_domains.includes(d)) server.excluded_domains.push(d);
      if ('paused_until' in b) server.paused_until = b.paused_until;
      return reply(200, server);
    }
    if (req.url === '/api/events') return reply(202, { accepted: 0, duplicates: 0 });
    reply(404, {});
  });
});
await new Promise(r => api.listen(8001, '127.0.0.1', r));
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-pv-')), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
await sleep(1000);
const hub = await ctx.newPage(); await hub.goto(`chrome-extension://${new URL(sw.url()).host}/grove.html`); await sleep(400);
const send = m => hub.evaluate(x => chrome.runtime.sendMessage(x), m);
const local = () => sw.evaluate(() => chrome.storage.local.get(null));
await sw.evaluate(() => chrome.storage.session.set({ tf_auth: { token: 'good-token', expires_at: Date.now() + 3600e3, provider: 'fallback' } }));

check('EXCLUDE_DOMAIN ok while the API has no /api/privacy yet (404)', (await send({ type: 'EXCLUDE_DOMAIN', domain: 'MyBank.com' })).ok);
check('PAUSE ok', (await send({ type: 'PAUSE', until: 'until resumed' })).ok);
await sleep(600);
let l = await local();
check('local settings apply at once', l.user_excluded_domains?.includes('mybank.com') && l.paused_until === 'until resumed', JSON.stringify([l.user_excluded_domains, l.paused_until]));
check('a 404 keeps the change waiting', JSON.stringify(l.tf_privacy_pending?.add) === '["mybank.com"]' && l.tf_privacy_pending?.paused?.value === '9999-12-31T23:59:59Z', JSON.stringify(l.tf_privacy_pending));

live = true;
await sw.evaluate(() => self.syncPrivacy()); await sleep(500);
l = await local();
check('once the API answers, PATCH carries both changes with the bearer token', patches.length >= 1 && patches.some(p => p.excluded_domains_add?.includes('mybank.com')) && patches.some(p => p.paused_until === '9999-12-31T23:59:59Z'), JSON.stringify(patches));
check('nothing left waiting', l.tf_privacy_pending === undefined, JSON.stringify(l.tf_privacy_pending));
check('server exclusions were read back and merged', l.user_excluded_domains?.includes('fromserver.test') && l.user_excluded_domains.includes('mybank.com'), JSON.stringify(l.user_excluded_domains));

check('resume (PAUSE null) is sent as null', (await send({ type: 'PAUSE', until: null })).ok);
await sleep(600);
check('PATCH paused_until:null', patches.at(-1)?.paused_until === null, JSON.stringify(patches.at(-1)));

await sw.evaluate(() => chrome.storage.local.set({ tf_work_items: [{ id: 1 }] }));
check('WIPE_LOCAL ok', (await send({ type: 'WIPE_LOCAL' })).ok);
await sleep(500);
l = await local();
const left = Object.keys(l);
check('after WIPE_LOCAL no queue, URLs, work items, exclusions or pending changes remain', !left.some(k => /queue|urls|work_items|excluded|pending|paused|last_sent/.test(k)), JSON.stringify(left));
await ctx.close(); api.close();
