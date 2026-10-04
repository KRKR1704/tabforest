import { chromium } from 'playwright';
import http from 'node:http'; import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
const EXT = path.resolve(process.env.EXT);
const check = (n, ok, d = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<!doctype html><title>Page ${req.url}</title><h1>${req.url}</h1>`); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-rs-'));
const launch = async () => {
  const c = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  let [sw] = c.serviceWorkers(); if (!sw) sw = await c.waitForEvent('serviceworker', { timeout: 15000 });
  await sleep(1000);
  const hub = await c.newPage(); await hub.goto(`chrome-extension://${new URL(sw.url()).host}/grove.html`); await sleep(400);
  return { c, sw, hub, send: m => hub.evaluate(x => chrome.runtime.sendMessage(x), m) };
};
let s = await launch();
for (const p of ['/a', '/b', '/c']) { const pg = await s.c.newPage(); await pg.goto(`http://localhost:${port}${p}`); await sleep(500); }
await sleep(1200);
const snap = (await s.send({ type: 'GET_SNAPSHOT' })).data.open_tabs;
const refs = snap.map(t => t.tab_ref).filter(Boolean);
check('three tabs captured with refs', refs.length >= 3, `${refs.length}`);
const mine = snap.filter(t => /localhost/.test(t.domain ?? t.url ?? '') || true).map(t => t.tab_ref);
await sleep(11000); // let the URL store flush
await s.c.close();
console.log('--- Chrome quit and reopened (same profile)');
s = await launch();
const before = s.c.pages().length;
const r = await s.send({ type: 'RESTORE', tab_refs: refs.slice(0, 3), group_name: 'Backend Authentication' });
check('RESTORE answers ok after restart', r.ok === true, JSON.stringify(r));
await sleep(1500);
const tabs = await s.sw.evaluate(async () => (await chrome.tabs.query({})).map(t => ({ url: t.url, groupId: t.groupId })));
const opened = tabs.filter(t => t.url.startsWith('http://localhost'));
check('the stored URLs reopened', opened.length === 3, JSON.stringify(opened.map(t => t.url)));
const gid = opened[0]?.groupId;
const grouped = typeof gid === 'number' && gid >= 0 && opened.every(t => t.groupId === gid);
const groups = await s.sw.evaluate(async () => chrome.tabGroups ? await chrome.tabGroups.query({}) : null);
console.log('group mode:', groups === null ? 'tabGroups API absent (permission not granted)' : JSON.stringify(groups.map(g => g.title)));
if (process.env.EXPECT_GROUP === '1') check('all three are in one group named Backend Authentication', grouped && groups?.[0]?.title === 'Backend Authentication', JSON.stringify(groups));
else check('without tabGroups: plain tabs, no group', opened.every(t => t.groupId === -1) && groups === null, JSON.stringify(opened));
const bad = await s.send({ type: 'RESTORE', tab_refs: ['nope'] });
check('unknown ref answers not_found', bad.ok === false && bad.error === 'not_found', JSON.stringify(bad));
await s.c.close(); server.close();
