import { chromium } from 'playwright';
import http from 'node:http'; import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
const EXT = path.resolve(process.env.EXT); const OUT = process.env.SHOT;
const results = []; const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pages = http.createServer((req, res) => { const p = req.url.split('?')[0]; res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<!doctype html><title>Page ${p}</title><h1>x</h1>`); });
await new Promise(r => pages.listen(0, '127.0.0.1', r)); const port = pages.address().port;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-e2e-'));
const context = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
let [sw] = context.serviceWorkers(); if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
const id = new URL(sw.url()).host; await sleep(800);
for (const n of ['a', 'b', 'c']) { const pg = await context.newPage(); await pg.goto(`http://localhost:${port}/${n}`); await sleep(700); }
const errors = [], failed = [], logs = [];
const grove = await context.newPage();
grove.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); else logs.push(m.text().slice(0, 120)); });
grove.on('pageerror', e => errors.push('PAGEERROR ' + String(e).slice(0, 200)));
grove.on('requestfailed', r => failed.push(r.url().slice(0, 100)));
await grove.goto(`chrome-extension://${id}/grove.html`); await sleep(4000);
const info = await grove.evaluate(() => ({ title: document.title, rootChildren: document.getElementById('root')?.children.length ?? 0, text: document.body.innerText.slice(0, 300), isExt: !!(window.chrome && chrome.runtime && chrome.runtime.id) }));
console.log('title:', info.title, '| #root children:', info.rootChildren, '| extension runtime:', info.isExt);
console.log('visible text:', JSON.stringify(info.text.replace(/\s+/g, ' ').slice(0, 220)));
console.log('console errors:', errors.length ? JSON.stringify(errors.slice(0, 6)) : 'none');
console.log('failed requests:', failed.length ? JSON.stringify(failed.slice(0, 4)) : 'none');
check('the Grove page loads inside the extension at grove.html', info.title.includes('Living Grove') && info.rootChildren > 0);
check('the Grove runs with the extension runtime (real bridge, not the stand-in)', info.isExt);
check('no CSP violation or script error', !errors.some(e => /Content Security Policy|PAGEERROR|Refused to/i.test(e)), errors.filter(e => /Content Security Policy|PAGEERROR|Refused/i.test(e)).join(' | '));
// the bridge answers the same page
const snap = await grove.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_SNAPSHOT' }));
check('the bridge returns the three real tabs to the Grove page', snap.ok && snap.data.open_tabs.length >= 3, `${snap.data?.open_tabs?.length} tabs`);
if (OUT) await grove.screenshot({ path: OUT, fullPage: false });
console.log('SUMMARY:', results.filter(Boolean).length, 'passed,', results.filter(x => !x).length, 'failed');
await context.close(); pages.close(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(results.includes(false) ? 1 : 0);
