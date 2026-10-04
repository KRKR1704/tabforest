import { afterEach, expect, test, vi } from 'vitest';
import { BUILTIN_DOMAINS, Hollow, redactText } from '../src/background/hollow';
import { registerCapture } from '../src/background/capture';
import { emit } from '../src/background/emit';
import { SESSION_KEY, URLS_KEY } from '../src/background/state';
import { fakeChrome, fakeStorage, tab } from './fake-chrome.mjs';

afterEach(() => vi.restoreAllMocks());

async function setup(tabs = [], settings = {}) {
  let time = 1000;
  const storage = fakeStorage(); Object.assign(storage.local.data, settings);
  const fake = fakeChrome(tabs, { id: 1, focused: true }, storage);
  const events = [];
  const capture = registerCapture(fake.api, e => { events.push(e); emit(e); }, () => time);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await capture.settled();
  return { ...fake, storage, events, log, ...capture, advance: ms => { time += ms; } };
}

for (const [category, domains] of Object.entries(BUILTIN_DOMAINS)) {
  test(`${category}: all starter domains, subdomains and auth paths are blocked`, async () => {
    const hollow = new Hollow(fakeStorage().local); await hollow.refresh();
    expect(domains.length).toBeGreaterThanOrEqual(2);
    for (const domain of domains) {
      expect(hollow.excluded({ url: `https://${domain}/` })).toBe(true);
      expect(hollow.excluded({ url: `https://www.${domain}/` })).toBe(true);
    }
    expect(hollow.excluded({ url: 'https://ordinary.example/login' })).toBe(true);
  });
}

test('user suffixes respect domain boundaries; all auth paths, incognito and non-http schemes block', async () => {
  const storage = fakeStorage(); storage.local.data.user_excluded_domains = ['mybank.com'];
  const hollow = new Hollow(storage.local); await hollow.refresh();
  for (const host of ['mybank.com', 'www.mybank.com', 'a.mybank.com']) expect(hollow.excluded({ url: `https://${host}` })).toBe(true);
  expect(hollow.excluded({ url: 'https://notmybank.com' })).toBe(false);
  for (const path of ['/login', '/signin', '/oauth/callback', '/auth', '/%6cogin']) expect(hollow.excluded({ url: `https://example.com${path}` })).toBe(true);
  for (const url of ['chrome://newtab', 'chrome-extension://abc/grove.html', 'file:///tmp/a', 'ftp://example.com', undefined]) expect(hollow.excluded({ url })).toBe(true);
  expect(hollow.excluded({ url: 'https://example.com', incognito: true })).toBe(true);
});

test('350-character token title is redacted, not truncated into a token', async () => {
  const h = await setup();
  h.api.tabs.onCreated.fire(tab(1, { title: 'x'.repeat(350) })); await h.settled();
  expect(h.events[0].title).toBe('[redacted]');
});

test('email, 12-digit number and hex token are individually redacted with surrounding words unchanged', () => {
  expect(redactText('Notes alice@example.com phone 123456789012 token 0123456789abcdef0123456789abcdef done'))
    .toBe('Notes [redacted] phone [redacted] token [redacted] done');
  expect(redactText('Plain research notes remain readable.')).toBe('Plain research notes remain readable.');
});

test('banking and login tabs emit nothing, count distinct tabs and never store banking URLs', async () => {
  const bank = tab(123456, { url: 'https://chase.com/account?secret=x', active: true });
  const login = tab(123457, { url: 'https://example.com/login' });
  const h = await setup([bank, login]);
  h.api.runtime.onInstalled.fire();
  for (const page of [bank, login]) {
    h.api.tabs.onCreated.fire(page);
    h.api.tabs.onUpdated.fire(page.id, { status: 'complete' }, page);
    h.api.tabs.onActivated.fire({ tabId: page.id, windowId: 1 });
  }
  h.api.idle.onStateChanged.fire('idle'); h.api.idle.onStateChanged.fire('active');
  await h.settled();
  expect(h.events).toHaveLength(0); expect(h.log).not.toHaveBeenCalled();
  expect(h.hollowCount()).toBe(2);
  expect(h.storage.session.data[SESSION_KEY].hollowTabs).toHaveLength(2);
  expect(JSON.stringify(h.storage.session.data)).not.toContain('chase.com');
  expect(JSON.stringify(h.storage.local.data)).not.toContain('chase.com');
  expect(h.storage.local.data[URLS_KEY]).toEqual([]);
  h.api.tabs.onRemoved.fire(bank.id); await h.settled();
  expect(h.events).toHaveLength(0); expect(h.hollowCount()).toBe(1);
});

test('allowed to excluded to allowed removes stored URL, stops dwell and resumes', async () => {
  const page = tab(1, { active: true }); const h = await setup([page]);
  const ref = h.events[0].tab_ref;
  h.advance(1000);
  const blocked = { ...page, url: 'https://paypal.com/account', title: 'Private' };
  h.tabs.set(1, blocked); h.api.tabs.onUpdated.fire(1, { url: blocked.url, title: blocked.title }, blocked);
  await h.settled();
  const count = h.events.length;
  expect(h.hollowCount()).toBe(1); expect(h.storage.local.data[URLS_KEY]).toEqual([]);
  h.advance(5000); h.api.idle.onStateChanged.fire('idle'); h.api.idle.onStateChanged.fire('active'); await h.settled();
  expect(h.events).toHaveLength(count);
  h.tabs.set(1, page); h.api.tabs.onUpdated.fire(1, { url: page.url, status: 'complete' }, page); await h.settled();
  expect(h.hollowCount()).toBe(0);
  expect(h.events.at(-1)).toMatchObject({ type: 'UPDATE', tab_ref: ref });
  h.advance(500); h.tabs.set(2, tab(2)); h.api.tabs.onActivated.fire({ tabId: 2, windowId: 1 }); await h.settled();
  expect(h.events.findLast(e => e.type === 'BLUR').active_ms).toBe(500);
});

test.each(['until resumed', 2000, '1970-01-01T00:00:02.000Z'])('pause drops all events and removal/expiry resumes: %s', async paused_until => {
  const page = tab(1, { active: true }); const h = await setup([page], { paused_until });
  h.api.tabs.onCreated.fire(page); h.api.runtime.onStartup.fire(); await h.settled();
  expect(h.events).toHaveLength(0); expect(h.storage.local.data[URLS_KEY]).toEqual([]);
  h.advance(2000); if (paused_until === 'until resumed') delete h.storage.local.data.paused_until;
  h.api.tabs.onUpdated.fire(1, { status: 'complete' }, page); await h.settled();
  expect(h.events.at(-1).type).toBe('UPDATE'); expect(h.hollowCount()).toBe(0);
});

test('emitted events and sanitized logs have no URL, email or Chrome ID', async () => {
  const h = await setup();
  const page = tab(987654, { title: 'Read alice@example.com at https://example.com/private' });
  h.api.tabs.onCreated.fire(page); await h.settled();
  const serialized = JSON.stringify({ events: h.events, logs: h.log.mock.calls });
  expect(serialized).not.toMatch(/https?:\/\/|[\w.+-]+@[\w.-]+\.\w+|987654|"tabId"/);
  expect(h.log.mock.calls).toEqual([[{ type: 'OPEN', event_id: h.events[0].event_id }]]);
});

test('incognito and user-excluded tabs produce no events or URL storage', async () => {
  const pages = [tab(1, { incognito: true, active: true }), tab(2, { url: 'https://www.mybank.com/account' })];
  const h = await setup(pages, { user_excluded_domains: ['mybank.com'] });
  for (const page of pages) h.api.tabs.onCreated.fire(page);
  h.api.runtime.onInstalled.fire(); await h.settled();
  expect(h.events).toHaveLength(0); expect(h.hollowCount()).toBe(2);
  expect(h.storage.local.data[URLS_KEY]).toEqual([]);
});

test('current URL is checked before focus loss, idle and close even without an update callback', async () => {
  const page = tab(1, { active: true }); const h = await setup([page]);
  const blocked = { ...page, url: 'https://chase.com/account' }; h.tabs.set(1, blocked);
  h.api.idle.onStateChanged.fire('idle'); await h.settled();
  h.api.tabs.onRemoved.fire(1); await h.settled();
  expect(h.events.map(e => e.type)).toEqual(['FOCUS']);
  expect(h.storage.local.data[URLS_KEY]).toEqual([]);
});

test('restart persists the distinct Hollow count without excluded URLs', async () => {
  const page = tab(1, { url: 'https://paypal.com/' }); const h = await setup([page]);
  const next = fakeChrome([page], { id: 1, focused: true }, h.storage);
  const output = vi.fn(); const capture = registerCapture(next.api, output, () => 5000);
  await capture.settled();
  expect(capture.hollowCount()).toBe(1); expect(output).not.toHaveBeenCalled();
  expect(JSON.stringify(h.storage.session.data)).not.toContain('paypal.com');
  expect(JSON.stringify(h.storage.local.data)).not.toContain('paypal.com');
});

test('D-4b full lists have approved counts and exclude every domain and www subdomain', async () => {
  expect(Object.fromEntries(Object.entries(BUILTIN_DOMAINS).map(([key, domains]) => [key, domains.length])))
    .toEqual({ bankingAndPayments: 26, healthPortals: 14, personalEmail: 12, passwordManagers: 6, identityProviders: 12 });
  const hollow = new Hollow(fakeStorage().local); await hollow.refresh();
  for (const domain of Object.values(BUILTIN_DOMAINS).flat()) {
    expect(hollow.excluded({ url: `https://${domain}/` }), domain).toBe(true);
    expect(hollow.excluded({ url: `https://www.${domain}/` }), `www.${domain}`).toBe(true);
  }
});

test('D-4b look-alike banking hosts are not suffix matches', async () => {
  const hollow = new Hollow(fakeStorage().local); await hollow.refresh();
  for (const domain of ['notchase.com', 'chase.com.example.test', 'mychase.com']) {
    expect(hollow.excluded({ url: `https://${domain}/` })).toBe(false);
  }
});

test('D-4b unsupported tabs stay silent without raising the Hollow count', async () => {
  const pages = ['about:blank', 'chrome://newtab/', 'chrome://settings/',
    'chrome-extension://abc/grove.html', 'file:///tmp/private.txt'].map((url, i) => tab(i + 1, { url }));
  const h = await setup(pages);
  h.api.runtime.onInstalled.fire();
  for (const page of pages) h.api.tabs.onCreated.fire(page);
  await h.settled();
  expect(h.hollowCount()).toBe(0);
  expect(h.storage.session.data[SESSION_KEY].hollowTabs).toEqual([]);
  expect(h.events).toHaveLength(0);
});

test('D-4b pause alone does not count ordinary tabs; banking plus login still count exactly two', async () => {
  const pages = [tab(1, { active: true }), tab(2, { url: 'https://chase.com/' }),
    tab(3, { url: 'https://example.com/login' }), tab(4, { url: 'about:blank' })];
  const h = await setup(pages, { paused_until: 'until resumed' });
  for (const page of pages) h.api.tabs.onCreated.fire(page);
  h.api.runtime.onStartup.fire(); await h.settled();
  expect(h.hollowCount()).toBe(2);
  expect(h.storage.session.data[SESSION_KEY].hollowTabs.sort()).toEqual([2, 3]);
  expect(h.events).toHaveLength(0);
});

test('D-4b pause alone yields zero and leaving a private page removes its counted reason', async () => {
  const h = await setup([tab(1, { active: true })], { paused_until: 5000 });
  h.api.tabs.onCreated.fire(tab(1)); await h.settled();
  expect(h.hollowCount()).toBe(0); expect(h.events).toHaveLength(0);
  const storage = fakeStorage(); storage.local.data.user_excluded_domains = ['private.example'];
  const hollow = new Hollow(storage.local); await hollow.refresh();
  for (const page of [tab(1, { url: 'https://private.example/' }), tab(2, { incognito: true })]) hollow.observe(page);
  expect(hollow.hollowCount()).toBe(2);
  expect(hollow.observe(tab(1, { url: 'chrome://newtab/' }))).toBe(true);
  expect(hollow.hollowCount()).toBe(1);
  hollow.observe(tab(2)); expect(hollow.hollowCount()).toBe(0);
});
