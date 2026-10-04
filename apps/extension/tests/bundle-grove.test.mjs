import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { bundleGrove } from '../scripts/bundle-grove.mjs';

const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const indexHtml = (extra = '') => `<!doctype html><html><head><title>Grove</title>
<script type="module" crossorigin src="./assets/index-AAA.js"></script>
<link rel="stylesheet" crossorigin href="./assets/index-BBB.css">${extra}</head><body><div id="root"></div></body></html>`;

function fixture({ html = indexHtml(), groveFiles = {}, extFiles = {}, withGrove = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tf-bundle-'));
  dirs.push(root);
  const groveDist = join(root, 'grove-dist');
  const extDist = join(root, 'ext-dist');
  mkdirSync(join(extDist, 'assets'), { recursive: true });
  writeFileSync(join(extDist, 'manifest.json'), '{}');
  writeFileSync(join(extDist, 'grove.html'), 'PLACEHOLDER');
  for (const [name, text] of Object.entries(extFiles)) writeFileSync(join(extDist, 'assets', name), text);
  if (withGrove) {
    mkdirSync(join(groveDist, 'assets'), { recursive: true });
    writeFileSync(join(groveDist, 'index.html'), html);
    const files = { 'index-AAA.js': 'console.log(1);\n//# sourceMappingURL=index-AAA.js.map',
      'index-AAA.js.map': '{}', 'index-BBB.css': 'body{}', ...groveFiles };
    for (const [name, text] of Object.entries(files)) writeFileSync(join(groveDist, 'assets', name), text);
  }
  return { groveDist, extDist };
}

const quiet = () => {};

test('copies the Grove build into the extension as grove.html and skips sourcemaps', () => {
  const { groveDist, extDist } = fixture();
  const result = bundleGrove({ groveDist, extDist, log: quiet });
  expect(result.bundled).toBe(true);
  expect(readFileSync(join(extDist, 'grove.html'), 'utf8')).toBe(indexHtml());
  expect(readdirSync(join(extDist, 'assets')).sort()).toEqual(['index-AAA.js', 'index-BBB.css']);
});

test('removes the sourcemap comment from copied scripts', () => {
  const { groveDist, extDist } = fixture();
  bundleGrove({ groveDist, extDist, log: quiet });
  expect(readFileSync(join(extDist, 'assets', 'index-AAA.js'), 'utf8')).not.toContain('sourceMappingURL');
  expect(readFileSync(join(extDist, 'assets', 'index-AAA.js'), 'utf8')).toContain('console.log(1);');
});

test('keeps the placeholder when the Grove build is missing', () => {
  const { groveDist, extDist } = fixture({ withGrove: false });
  const result = bundleGrove({ groveDist, extDist, log: quiet });
  expect(result).toEqual({ bundled: false, reason: 'missing' });
  expect(readFileSync(join(extDist, 'grove.html'), 'utf8')).toBe('PLACEHOLDER');
});

test('refuses to run before the extension is built', () => {
  const { groveDist, extDist } = fixture();
  rmSync(join(extDist, 'manifest.json'));
  expect(() => bundleGrove({ groveDist, extDist, log: quiet })).toThrow(/pnpm build/);
});

test('refuses an inline script, a remote script and an inline event handler, and writes nothing', () => {
  for (const html of [
    indexHtml('<script>alert(1)</script>'),
    indexHtml('<script src="https://cdn.example/x.js"></script>'),
    indexHtml('<script src="/abs.js"></script>'),
    `<!doctype html><body onclick="x()"><script type="module" src="./assets/index-AAA.js"></script></body>`,
  ]) {
    const { groveDist, extDist } = fixture({ html });
    expect(() => bundleGrove({ groveDist, extDist, log: quiet })).toThrow(/not extension-safe/);
    expect(readFileSync(join(extDist, 'grove.html'), 'utf8')).toBe('PLACEHOLDER');
    expect(existsSync(join(extDist, 'assets', 'index-AAA.js'))).toBe(false);
  }
});

test('refuses a page that points at a file that is not in the build', () => {
  const { groveDist, extDist } = fixture({ html: indexHtml('<link rel="modulepreload" href="./assets/missing.js">') });
  expect(() => bundleGrove({ groveDist, extDist, log: quiet })).toThrow(/missing\.js/);
});

test('does not overwrite an extension file of the same name with different content', () => {
  const { groveDist, extDist } = fixture({ extFiles: { 'index-AAA.js': 'extension code' } });
  expect(() => bundleGrove({ groveDist, extDist, log: quiet })).toThrow(/refusing to overwrite/);
  expect(readFileSync(join(extDist, 'assets', 'index-AAA.js'), 'utf8')).toBe('extension code');
  expect(readFileSync(join(extDist, 'grove.html'), 'utf8')).toBe('PLACEHOLDER');
});

test('is safe to run twice', () => {
  const { groveDist, extDist } = fixture();
  bundleGrove({ groveDist, extDist, log: quiet });
  expect(() => bundleGrove({ groveDist, extDist, log: quiet })).not.toThrow();
});
