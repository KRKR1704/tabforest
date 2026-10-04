// Makes the extension build the full-stack test needs, from a normal build with the Grove bundled:
//   cd apps/grove && npm ci && VITE_MOCK=0 VITE_API_BASE_URL=http://127.0.0.1:8001 npm run build
//   cd apps/extension && pnpm build:with-grove          (the extension's default API address is http://127.0.0.1:8001)
//   node e2e/full-stack/prepare-build.mjs dist /tmp/tf-full-stack-build
// Changes in the copy only (never in dist/):
//   - Date.now in the service worker goes through globalThis.__tfNow, so the test can move the extension's clock and
//     "browse" for five hours in a minute, with the timestamps and dwell a real day would have;
//   - tabGroups becomes a normal permission and web pages are allowed for the right-click code path, because
//     headless Chromium cannot answer a permission prompt or give activeTab to a script call.
import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [src, out] = [process.argv[2], process.argv[3]].map(p => p && resolve(p));
if (!src || !out) { console.error('usage: node prepare-build.mjs <dist> <out>'); process.exit(1); }
rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });
const worker = readdirSync(join(out, 'assets')).find(f => /^index\.ts-.*\.js$/.test(f));
const file = join(out, 'assets', worker);
const patched = readFileSync(file, 'utf8').replace(/\bDate\.now\b/g, 'globalThis.__tfNow');
writeFileSync(file, 'const __realNow=Date.now.bind(Date);globalThis.__tfNow=()=>__realNow()+(globalThis.__skew||0);\n' + patched);
const manifestFile = join(out, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
manifest.permissions.push('tabGroups');
manifest.optional_permissions = (manifest.optional_permissions ?? []).filter(x => x !== 'tabGroups');
manifest.host_permissions = ['http://*/*', 'https://*/*'];
writeFileSync(manifestFile, JSON.stringify(manifest));
console.log(`full-stack build written to ${out} (service worker: ${worker})`);
