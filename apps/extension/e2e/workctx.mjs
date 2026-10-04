import { chromium } from 'playwright';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const EXT = path.resolve(process.env.EXT);
const check = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PAGE = `<!doctype html><title>Ticket CAM-142 - Jira</title>
<nav>Navigation noise</nav>
<main><h1>Migration plan</h1><p>The decision is Azure Functions.</p>
<p>Second <b>bold</b> paragraph.</p>
<input value="INPUTSECRET"><textarea>TEXTAREASECRET</textarea>
<div contenteditable>EDITABLESECRET</div>
<div style="display:none">HIDDENSECRET</div><div hidden>HIDDEN2SECRET</div>
<p style="visibility:hidden">INVISIBLESECRET</p>
<script>var x="SCRIPTSECRET"</script><style>.a{content:"STYLESECRET"}</style>
<select><option>OPTIONSECRET</option></select></main>`;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(req.url.startsWith('/empty') ? '<!doctype html><title>x</title>' : PAGE);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'tf-wc-')), {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--host-resolver-rules=MAP chase.com 127.0.0.1'],
});
let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
await sleep(1000);
const extId = new URL(sw.url()).host;
const hub = await context.newPage();
await hub.goto(`chrome-extension://${extId}/grove.html`);
await sleep(500);
const bridge = type => hub.evaluate(t => chrome.runtime.sendMessage({ type: t }), type);

const menus = await sw.evaluate(() => typeof self.addToWorkContext);
check('worker exposes addToWorkContext', menus === 'function', menus);

async function addFrom(url, selection) {
  const pg = await context.newPage();
  await pg.goto(url).catch(() => {});
  await pg.bringToFront(); await sleep(600);
  const r = await sw.evaluate(s => self.addToWorkContext(s), selection ?? null);
  await sleep(300);
  const badge = await sw.evaluate(async () => { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return chrome.action.getBadgeText({ tabId: t.id }); });
  return { r, badge, pg };
}

const ok = await addFrom(`http://localhost:${port}/ticket?token=SECRET#frag`);
check('page add succeeds with ✓ badge', ok.r?.ok === true && ok.badge === '✓', JSON.stringify(ok.r) + ' badge=' + ok.badge);
let items = (await bridge('GET_WORK_ITEMS')).data.items;
check('one item via bridge', items.length === 1, String(items.length));
const it = items[0] ?? {};
check('title and source type', it.title === 'Ticket CAM-142 - Jira' && it.source_type === 'page_text', `${it.title} / ${it.source_type}`);
check('url has no query/hash', it.url === `http://localhost:${port}/ticket`, it.url);
check('page text includes visible content', /Migration plan/.test(it.text) && /Azure Functions/.test(it.text) && /bold/.test(it.text), JSON.stringify(it.text));
const leaks = ['INPUTSECRET', 'TEXTAREASECRET', 'EDITABLESECRET', 'HIDDENSECRET', 'HIDDEN2SECRET', 'INVISIBLESECRET', 'SCRIPTSECRET', 'STYLESECRET', 'OPTIONSECRET'].filter(s => it.text?.includes(s));
check('no inputs/textarea/editable/hidden/script/style text leaked', leaks.length === 0, leaks.join(',') || 'clean');
check('nav outside <main> not captured (main preferred)', !/Navigation noise/.test(it.text ?? ''), '');

const sel = await addFrom(`http://localhost:${port}/other`, 'Only this sentence.');
items = (await bridge('GET_WORK_ITEMS')).data.items;
const s = items.find(i => i.source_type === 'selection');
check('selection stored as typed', sel.r?.ok && s?.text === 'Only this sentence.', JSON.stringify(s));

const bank = await addFrom(`http://chase.com:${port}/`);
const after = (await bridge('GET_WORK_ITEMS')).data.items;
check('private host refused with ! badge, nothing stored', bank.r?.ok === false && bank.badge === '!' && after.length === items.length, JSON.stringify(bank.r) + ' badge=' + bank.badge);

const empty = await addFrom(`http://localhost:${port}/empty`);
check('page with no text refused', empty.r?.ok === false, JSON.stringify(empty.r));

const blank = await context.newPage(); await blank.goto('about:blank'); await blank.bringToFront(); await sleep(400);
const bl = await sw.evaluate(() => self.addToWorkContext());
check('about:blank refused', bl?.ok === false, JSON.stringify(bl));

const stored = await sw.evaluate(async () => ({ local: Object.keys(await chrome.storage.local.get(null)), session: Object.keys(await chrome.storage.session.get(null)) }));
check('items only in local storage', stored.local.includes('tf_work_items') && !stored.session.includes('tf_work_items'), JSON.stringify(stored));

check('CLEAR_WORK_ITEMS empties', (await bridge('CLEAR_WORK_ITEMS')).ok && (await bridge('GET_WORK_ITEMS')).data.items.length === 0);
await context.close(); server.close();
