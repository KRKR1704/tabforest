import { chromium } from 'playwright';
import http from 'node:http'; import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
const EXT = path.resolve(process.env.EXT); const SHOT = process.env.SHOT;
const ORIGIN = 'chrome-extension://nldemblgfgcaolkpkajdbefjfnileeoi';
const results = []; const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');

// stand-in for P's API: fallback login + events that need the Bearer token
const issued = new Set(); const stored = new Map(); const calls = [];
const api = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Dev-User', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const reply = (s, o) => { res.writeHead(s, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(o)); };
    if (req.url === '/api/auth/login') {
      const b = JSON.parse(body || '{}'); calls.push({ url: req.url, body: b });
      if (b.email === 'demo@example.com' && b.password === 'correct horse') {
        const now = Math.floor(Date.now() / 1000);
        const token = `${b64({ alg: 'HS256' })}.${b64({ sub: '11111111-2222-5333-8444-555555555555', email: b.email, iss: 'tabforest-fallback', aud: 'tabforest-api', iat: now, exp: now + 3600 })}.sig`;
        issued.add(token); return reply(200, { access_token: token, token_type: 'Bearer', expires_in: 3600 });
      }
      return reply(401, { title: 'Email or password is incorrect' });
    }
    if (req.url === '/api/events') {
      const auth = req.headers.authorization ?? ''; calls.push({ url: req.url, auth });
      if (!auth.startsWith('Bearer ') || !issued.has(auth.slice(7))) return reply(401, { title: 'Unauthorized' });
      const events = JSON.parse(body).events; let accepted = 0, duplicates = 0;
      for (const e of events) { if (stored.has(e.event_id)) duplicates++; else { stored.set(e.event_id, e); accepted++; } }
      return reply(202, { accepted, duplicates });
    }
    reply(404, {});
  });
});
await new Promise(r => api.listen(8001, '127.0.0.1', r));
const pages = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<!doctype html><title>Page ${req.url}</title><h1>x</h1>`); });
await new Promise(r => pages.listen(0, '127.0.0.1', r)); const port = pages.address().port;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-e2e-'));
const context = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true, viewport: { width: 900, height: 700 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
let [sw] = context.serviceWorkers(); if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
const id = new URL(sw.url()).host; await sleep(800);
const host = await context.newPage(); await host.goto(`chrome-extension://${id}/grove.html`);
const send = m => host.evaluate(x => chrome.runtime.sendMessage(x), m);
for (const n of ['a', 'b']) { const pg = await context.newPage(); await pg.goto(`http://localhost:${port}/${n}`); await sleep(600); }

check('signed out at first', (await send({ type: 'GET_AUTH_STATE' })).data.signed_in === false && (await send({ type: 'GET_TOKEN' })).data.token === null);
await sw.evaluate(() => self.flushNow()); await sleep(300);
const pre = await sw.evaluate(() => self.sendPreview());
check('without a token the API says 401 and the events stay queued', calls.some(c => c.url === '/api/events' && c.auth === '') && pre.pending_count > 0, `pending ${pre.pending_count}`);

// sign in through the popup: first a wrong password, then the right one
const popupPromise = context.waitForEvent('page', { predicate: p => p.url().includes('signin.html'), timeout: 10000 });
const signIn = send({ type: 'SIGN_IN' });
const popup = await popupPromise; await popup.waitForLoadState();
check('SIGN_IN opens the sign-in window of the extension', popup.url() === `${ORIGIN}/signin.html`, popup.url());
await popup.fill('#email', 'demo@example.com'); await popup.fill('#password', 'wrong password'); await popup.click('#submit');
await popup.waitForFunction(() => document.getElementById('error').textContent.length > 0);
const err = await popup.textContent('#error');
check('a wrong password shows a clear message and clears the field', /incorrect/i.test(err) && (await popup.inputValue('#password')) === '', err);
if (SHOT) await popup.screenshot({ path: SHOT });
await popup.fill('#password', 'correct horse'); await popup.click('#submit');
const result = await signIn;
check('the right password resolves SIGN_IN with the signed-in profile', result.ok && result.data.signed_in && result.data.email === 'demo@example.com' && result.data.user_id === '11111111-2222-5333-8444-555555555555', JSON.stringify(result));
await sleep(500);
check('the sign-in window closes itself', popup.isClosed());
const token = (await send({ type: 'GET_TOKEN' })).data.token;
check('GET_TOKEN returns the token and GET_AUTH_STATE shows the user', !!token && (await send({ type: 'GET_AUTH_STATE' })).data.email === 'demo@example.com');
const where = await sw.evaluate(async () => ({ session: JSON.stringify(await chrome.storage.session.get(null)), local: JSON.stringify(await chrome.storage.local.get(null)) }));
check('the token is in session storage only; the password is nowhere', where.session.includes(token) && !where.local.includes(token) && !where.session.includes('correct horse') && !where.local.includes('correct horse'));

// events now carry the token and the queue drains
const r = await sw.evaluate(() => self.flushNow());
check('after sign-in the queued events are accepted with the Bearer token', r && r.accepted > 0 && r.duplicates === 0 && calls.some(c => c.auth === `Bearer ${token}`), JSON.stringify(r));
const post = await sw.evaluate(() => self.sendPreview());
check('the queue is empty after the send', post.pending_count === 0);

// sign out: token gone, queue and last batch cleared, capture still running locally
const other = await context.newPage(); await other.goto(`http://localhost:${port}/c`); await sleep(500);
const out = await send({ type: 'SIGN_OUT' });
const afterOut = await sw.evaluate(async () => ({ preview: await self.sendPreview(), keys: Object.keys(await chrome.storage.local.get(null)) }));
check('SIGN_OUT clears the token, the queue and the last sent batch', out.ok && (await send({ type: 'GET_TOKEN' })).data.token === null && afterOut.preview.pending_count === 0 && !afterOut.keys.includes('last_sent_batch') && (await send({ type: 'GET_AUTH_STATE' })).data.signed_in === false, JSON.stringify(afterOut.keys));
const more = await context.newPage(); await more.goto(`http://localhost:${port}/d`); await sleep(800);
check('capture keeps queuing locally while signed out', (await sw.evaluate(() => self.sendPreview())).pending_count > 0);

// cancel: closing the window ends SIGN_IN with cancelled
const p2 = context.waitForEvent('page', { predicate: p => p.url().includes('signin.html'), timeout: 10000 });
const second = send({ type: 'SIGN_IN' }); const popup2 = await p2; await popup2.waitForLoadState(); await sleep(300); await popup2.close();
const cancelled = await second;
check('closing the sign-in window ends SIGN_IN with cancelled', !cancelled.ok && cancelled.error === 'cancelled', JSON.stringify(cancelled));
const p3 = context.waitForEvent('page', { predicate: p => p.url().includes('signin.html'), timeout: 10000 });
const third = send({ type: 'SIGN_IN' }); const popup3 = await p3; await popup3.waitForLoadState(); await popup3.click('#cancel');
check('the Cancel button ends SIGN_IN with cancelled', (await third).error === 'cancelled');
// the page cannot be abused from an ordinary web page: messages need the extension
check('the server never saw a password in an events request', !JSON.stringify(calls.filter(c => c.url === '/api/events')).includes('correct horse'));
console.log('\nSUMMARY:', results.filter(Boolean).length, 'passed,', results.filter(x => !x).length, 'failed');
await context.close(); api.close(); pages.close(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(results.includes(false) ? 1 : 0);
