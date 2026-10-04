import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { DEFAULT_API_BASE, EXPECTED_ID_KEY_START, EXPECTED_PERMISSIONS, verifyDist, zipName } from '../scripts/build-zip.mjs';

const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const goodManifest = () => ({
  version: '0.1.0', key: `${EXPECTED_ID_KEY_START}rest`, permissions: [...EXPECTED_PERMISSIONS],
  optional_permissions: ['tabGroups'], incognito: 'not_allowed',
});
function dist({ manifest = goodManifest(), grove = '<html>Grove app</html>', files = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tf-zip-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(dir, 'grove.html'), grove);
  writeFileSync(join(dir, 'assets', 'index.js'), `fetch("${DEFAULT_API_BASE}/api/events")`);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

test('a good build has no problems and a name from the version', () => {
  const dir = dist();
  expect(verifyDist(dir)).toEqual([]);
  expect(zipName(dir)).toBe('tabforest-extension-0.1.0.zip');
});

test.each([
  ['a missing key', { manifest: { ...goodManifest(), key: undefined } }, /extension ID/],
  ['an extra permission', { manifest: { ...goodManifest(), permissions: [...EXPECTED_PERMISSIONS, 'history'] } }, /permissions differ/],
  ['host permissions', { manifest: { ...goodManifest(), host_permissions: ['<all_urls>'] } }, /host permissions/],
  ['a changed optional permission', { manifest: { ...goodManifest(), optional_permissions: [] } }, /optional permissions/],
  ['incognito allowed', { manifest: { ...goodManifest(), incognito: undefined } }, /incognito/],
  ['the placeholder grove page', { grove: '<p id="extension-id"></p>' }, /placeholder/],
  ['a sourcemap', { files: { 'a.js.map': '{}' } }, /sourcemaps/],
  ['the local mock API', { files: { 'b.js': 'x="http://127.0.0.1:8001"' } }, /local mock/],
])('refuses %s', (_name, options, expected) => {
  expect(verifyDist(dist(options)).join('\n')).toMatch(expected);
});

test('refuses a build that was not made with the requested API base', () => {
  expect(verifyDist(dist(), { apiBase: 'https://other.example' }).join('\n')).toMatch(/API base/);
});

test('says so when there is no build at all', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tf-zip-'));
  dirs.push(dir);
  expect(verifyDist(dir)[0]).toMatch(/build the extension first/);
});
