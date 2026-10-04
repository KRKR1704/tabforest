// Shared helpers for the full-stack run: pages that look like the 28 demo tabs, a Chromium with the extension, sign-in.
// EXT is the prepared build (prepare-build.mjs); the API runs on 127.0.0.1:8001 (run-full-stack.sh).
import { chromium } from 'playwright';
import http from 'node:http'; import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
export const EXT = path.resolve(process.env.EXT);
export const SH = process.env.SHOTS;
export const API = 'http://127.0.0.1:8001';
export const sleep = ms => new Promise(r => setTimeout(r, ms));
const demo = JSON.parse(fs.readFileSync(process.env.DEMO_TABS, 'utf8')).open_tabs;
export const TABS = demo.map((t, i) => ({ n: i + 1, domain: t.domain, title: t.title, query: t.search_query }));
const HOLLOW = ['chase.com', 'my.1password.com', 'accounts.google.com'];
let results = [];
export const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`); return ok; };
export const known = (what) => console.log(`KNOWN  ${what}`);
export const summary = () => { console.log(`SUMMARY: ${results.filter(Boolean).length} passed, ${results.filter(x => !x).length} failed`); if (results.some(x => !x)) process.exitCode = 1; };

export async function startPages() {
  const server = http.createServer((req, res) => {
    const host = (req.headers.host || '').split(':')[0];
    const m = /^\/t(\d+)/.exec(req.url);
    const tab = m ? TABS[Number(m[1]) - 1] : null;
    const title = tab ? tab.title : (host === 'chase.com' ? 'Chase Personal Banking' : host === 'my.1password.com' ? '1Password Vault' : 'Google Account Authentication');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>${title.replace(/</g, '&lt;')}</title><main><h1>${title.replace(/</g, '&lt;')}</h1><p>Page ${tab ? tab.n : 0} on ${host}.</p><input value="SECRETFIELD${tab ? tab.n : 0}"></main>`);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port };
}

export async function launch(port) {
  const domains = [...new Set([...TABS.map(t => t.domain), ...HOLLOW])];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-e2e-'));
  const rules = domains.map(d => `MAP ${d} 127.0.0.1`).join(', ');
  const ctx = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true, viewport: { width: 1280, height: 860 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--host-resolver-rules=${rules}`] });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  await sleep(1000);
  return { ctx, sw, dir, url: (t) => `http://${t.domain}:${port}/t${t.n}`, host: new URL(sw.url()).host };
}

export async function openGrove(env) {
  const page = await env.ctx.newPage();
  await page.goto(`chrome-extension://${env.host}/grove.html`);
  await sleep(1200);
  return page;
}

export function py(code) {
  return execFileSync('uv', ['run', 'python', '-c', code], { cwd: process.env.API_DIR, encoding: 'utf8', env: process.env }).trim();
}
export const sql = (query, ...args) => JSON.parse(py(`
import asyncio, os, json, asyncpg, sys
async def main():
    c = await asyncpg.connect(os.environ['DATABASE_URL'])
    rows = await c.fetch(${JSON.stringify(query)}, ${args.map(a => JSON.stringify(a)).join(', ')})
    print(json.dumps([dict(r) for r in rows], default=str))
asyncio.run(main())`));

/** Browse the demo tabs with the extension's clock moved back, so the tabs are opened hours apart like a real day. */
export async function browseDay(env, { minutesBetween = 9, revisit = true } = {}) {
  const { ctx, sw } = env;
  const pages = [];
  const start = -(TABS.length * minutesBetween + 40) * 60_000;
  const at = async (minutes) => sw.evaluate(ms => { globalThis.__skew = ms; }, start + minutes * 60_000);
  let clock = 0;
  for (const t of TABS) {
    await at(clock);
    const p = await ctx.newPage(); await p.goto(env.url(t)).catch(() => {}); pages.push(p);
    await sleep(500);
    clock += minutesBetween;
  }
  if (revisit) {
    for (const i of [0, 8, 1, 14, 9, 0]) { await at(clock); await pages[i].bringToFront(); await sleep(400); clock += 4; }
  }
  await at(clock + 2);
  return pages;
}
export async function visitHollow(env, port) {
  for (const host of ['chase.com', 'my.1password.com', 'accounts.google.com']) {
    const p = await env.ctx.newPage(); await p.goto(`http://${host}:${port}/signin`).catch(() => {}); await sleep(500);
  }
}
export async function signIn(env, grove) {
  const popupPromise = env.ctx.waitForEvent('page', { timeout: 10000 });
  await grove.getByRole('button', { name: /Sign in with Microsoft/ }).click();
  const popup = await popupPromise; await popup.waitForLoadState();
  await popup.fill('#email', 'demo@example.com'); await popup.fill('#password', 'correct horse battery');
  await popup.click('#submit');
  await sleep(2500);
}
export const token = (page) => page.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'GET_TOKEN' })).data.token);
export const apiCall = (page, method, p, body) => page.evaluate(async ([method, p, body, API]) => {
  const t = (await chrome.runtime.sendMessage({ type: 'GET_TOKEN' })).data.token;
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}, [method, p, body, API]);
