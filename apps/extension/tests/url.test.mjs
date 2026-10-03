import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { dupKey, normalizeUrl, searchQuery } from '../src/background/url';

test('normalization drops scheme, www, trailing slash, fragment and every tracking parameter', async () => {
  const first = 'HTTPS://WWW.Example.COM/path/?z=2&utm_source=x&fbclid=x&gclid=x&mc_cid=x&mc_eid=x&ref=x&a=1#fragment';
  const second = 'http://example.com/path?a=1&z=2';
  expect(normalizeUrl(first)).toBe('example.com/path?a=1&z=2');
  expect(await dupKey(first)).toBe(await dupKey(second));
  expect(await dupKey(first)).toMatch(/^[0-9a-f]{64}$/);
  expect(await dupKey('https://example.com/PATH')).not.toBe(await dupKey('https://example.com/path'));
});

test('reproduces the snapshot fixture duplicate pair with reconstructed FastAPI URLs', async () => {
  const snapshot = JSON.parse(readFileSync(new URL('../../../contracts/snapshot.example.json', import.meta.url), 'utf8'));
  const pair = snapshot.open_tabs.filter(t => t.dup_key === snapshot.open_tabs[0].dup_key);
  expect(pair).toHaveLength(2);
  const urls = ['https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/',
    'https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/?utm_source=search'];
  for (const [i, url] of urls.entries()) expect(await dupKey(url)).toBe(pair[i].dup_key);
});

test.each([
  ['https://www.google.com/search?q=refresh+token', 'refresh token'],
  ['https://www.bing.com/search?q=refresh%20token', 'refresh token'],
  ['https://duckduckgo.com/?q=refresh+token', 'refresh token'],
  ['https://search.brave.com/search?q=refresh+token', 'refresh token'],
  ['https://www.ecosia.org/search?q=refresh+token', 'refresh token'],
  ['https://search.yahoo.com/search?p=refresh+token', 'refresh token'],
  ['https://example.com/?q=secret', null],
  ['https://google.com.evil.invalid/?q=secret', null],
  ['https://www.google.com/', null],
  ['chrome://newtab/', null],
  ['not a URL', null],
])('search query: %s', (url, expected) => expect(searchQuery(url)).toBe(expected));
