import { chromium } from 'playwright';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const EXT = path.resolve(process.env.EXT);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0];
  const p = req.url.split('?')[0];
  const title = host === 'chase.com' ? 'Chase Bank - Accounts 123456789012' :
    p === '/login' ? 'Sign in to Acme' :
    p === '/redact' ? 'Receipt for jane.doe@example.com order 123456789012 key a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4' :
    p === '/a' ? 'Alpha page' : 'Other';
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><title>${title}</title><h1>${title}</h1>`);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-e2e-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
         '--host-resolver-rules=MAP chase.com 127.0.0.1, MAP mail.google.com 127.0.0.1, MAP mychart.com 127.0.0.1, MAP news.example 127.0.0.1'],
});
const lines = [];
context.on('console', async msg => {
  try {
    const vals = await Promise.all(msg.args().map(a => a.jsonValue().catch(() => null)));
    if (vals[0] === '[tf-capture]') lines.push(vals[1]);
    else if (vals.length === 1 && vals[0] && typeof vals[0] === 'object' && 'event_id' in vals[0]) lines.push(vals[0]);
  } catch {}
});
let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
await sleep(1000);

const mark = () => lines.length;
const visit = async (url, wait = 1200) => { const pg = await context.newPage(); const before = mark(); await pg.goto(url).catch(() => {}); await sleep(wait); return { pg, n: lines.length - before, types: lines.slice(before).map(l => l.type) }; };

const hollowBefore = await sw.evaluate(() => (typeof self.hollowCount === 'function' ? self.hollowCount() : null));
console.log('hollowCount() exposed on the worker:', hollowBefore !== null, '| before:', hollowBefore);

const ordinary = await visit(`http://localhost:${port}/a`);
check('ordinary page produces events', ordinary.n > 0, `${ordinary.n} log lines`);
const bank = await visit(`http://chase.com:${port}/`);
console.log('lines produced while visiting chase.com:', bank.types.join(',') || '(none)');
check('banking host (chase.com) produces no OPEN/UPDATE/FOCUS/CLOSE of its own (a BLUR of the PREVIOUS ordinary tab is allowed)', bank.types.every(t => t === 'BLUR'), bank.types.join(','));
const mail = await visit(`http://mail.google.com:${port}/`);
check('personal email host (mail.google.com) produces NO event lines', mail.n === 0, `${mail.n} lines`);
const health = await visit(`http://mychart.com:${port}/`);
check('health portal host (mychart.com) produces NO event lines', health.n === 0, `${health.n} lines`);
const login = await visit(`http://localhost:${port}/login`);
check('/login page on an ordinary host produces NO event lines', login.n === 0, `${login.n} lines`);
const redact = await visit(`http://localhost:${port}/redact`);
check('page with email, 12-digit number and token in its title still works (events produced)', redact.n > 0, `${redact.n} lines`);

// switching between tabs while a sensitive tab is focused must not leak FOCUS/BLUR/IDLE for it
const before = mark();
await bank.pg.bringToFront(); await sleep(800); await ordinary.pg.bringToFront(); await sleep(800);
const switchLines = lines.slice(before).map(l => l.type);
console.log('lines while switching to the bank tab and back:', switchLines.join(','));

check('there are log lines to inspect', lines.length > 0, `${lines.length} lines`);
check('every log line contains only type and event_id', lines.every(l => JSON.stringify(Object.keys(l).sort()) === JSON.stringify(['event_id', 'type'])));
check('log lines contain no URL, domain or title text', !/https?:|localhost|chase|Alpha|Sign in|Receipt|jane/i.test(JSON.stringify(lines)));

// local storage must not hold sensitive URLs
const store = await sw.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }));
const dump = JSON.stringify(store);
check('banking, email and health URLs are NOT in chrome.storage', !/chase\.com|mail\.google\.com|mychart\.com/.test(dump));
check('the /login URL is NOT in chrome.storage', !/\/login/.test(dump));
check('the ordinary page URL IS stored locally (restore needs it)', /localhost:\d+\/a/.test(dump));

const hollowAfter = await sw.evaluate(() => (typeof self.hollowCount === 'function' ? self.hollowCount() : null));
console.log('hollowCount() before:', hollowBefore, 'after:', hollowAfter, '(4 sensitive tabs were opened: chase, mail.google, mychart, /login)');
const delta = hollowAfter - hollowBefore;
check('Hollow counter rose by exactly the number of sensitive tabs (4)', delta === 4, `+${delta}`);

console.log('\nSUMMARY:', results.filter(Boolean).length, 'passed,', results.filter(x => !x).length, 'failed');
await context.close(); server.close(); fs.rmSync(userDataDir, { recursive: true, force: true });
process.exit(results.includes(false) ? 1 : 0);
