// D-13: build the installable zip. Builds the extension, bundles the Grove UI, checks the result and zips it.
//   pnpm build:zip                      -> tabforest-extension-<version>.zip in apps/extension/
// Needs the Grove build (apps/grove: npm ci && npm run build). API base defaults to the deployed API;
// set VITE_API_BASE to point somewhere else. The zip is what a teammate unzips and loads with "Load unpacked".
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const EXPECTED_ID_KEY_START = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjdWh3hkU9XB7';
export const EXPECTED_PERMISSIONS = ['tabs', 'storage', 'idle', 'identity', 'contextMenus', 'activeTab', 'scripting'];
export const DEFAULT_API_BASE = 'https://tabforest.azurewebsites.net';

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Everything that must be true of a build before it is handed to someone. Returns a list of problems. */
export function verifyDist(dist, { apiBase = DEFAULT_API_BASE } = {}) {
  const problems = [];
  const manifestPath = join(dist, 'manifest.json');
  if (!existsSync(manifestPath)) return [`${manifestPath} is missing; build the extension first`];
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!String(manifest.key ?? '').startsWith(EXPECTED_ID_KEY_START)) problems.push('manifest key is missing or changed: the extension ID would differ (it must be nldemblgfgcaolkpkajdbefjfnileeoi)');
  if (JSON.stringify([...(manifest.permissions ?? [])].sort()) !== JSON.stringify([...EXPECTED_PERMISSIONS].sort())) problems.push(`permissions differ from the approved list: ${JSON.stringify(manifest.permissions)}`);
  if (JSON.stringify(manifest.optional_permissions ?? []) !== '["tabGroups"]') problems.push(`optional permissions differ: ${JSON.stringify(manifest.optional_permissions)}`);
  if (manifest.host_permissions?.length || manifest.content_scripts?.length) problems.push('host permissions or content scripts found; the privacy page says there are none');
  if (manifest.incognito !== 'not_allowed') problems.push('incognito is not set to not_allowed');
  const files = walk(dist);
  const maps = files.filter(f => f.endsWith('.map'));
  if (maps.length) problems.push(`sourcemaps would be shipped: ${maps.map(f => relative(dist, f)).join(', ')}`);
  const grove = join(dist, 'grove.html');
  if (!existsSync(grove) || /TabForest grove placeholder|id="extension-id"/.test(readFileSync(grove, 'utf8'))) problems.push('grove.html is the placeholder: build apps/grove and bundle it');
  const scripts = files.filter(f => /\.(js|html)$/.test(f)).map(f => readFileSync(f, 'utf8')).join('\n');
  if (!scripts.includes(apiBase)) problems.push(`the API base ${apiBase} is not in the build (VITE_API_BASE was not applied)`);
  if (/127\.0\.0\.1:8001/.test(scripts) && apiBase !== 'http://127.0.0.1:8001') problems.push('the build still points at the local mock API (127.0.0.1:8001)');
  return problems;
}

export function zipName(dist) {
  return `tabforest-extension-${JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8')).version}.zip`;
}

function run(cmd, args, options = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', ...options });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(here, '..');
  const dist = join(root, 'dist');
  const grove = resolve(root, '..', 'grove', 'dist');
  const apiBase = process.env.VITE_API_BASE || DEFAULT_API_BASE;
  if (!existsSync(join(grove, 'index.html'))) {
    console.error(`build:zip: the Grove build is missing (${grove}).\nRun: cd apps/grove && npm ci && npm run build`);
    process.exit(1);
  }
  const env = { ...process.env, VITE_API_BASE: apiBase };
  rmSync(dist, { recursive: true, force: true });
  run('npx', ['vite', 'build'], { cwd: root, env });
  run('node', ['scripts/bundle-grove.mjs'], { cwd: root, env });
  const problems = verifyDist(dist, { apiBase });
  if (problems.length) {
    console.error(`build:zip: refusing to zip, ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  const out = join(root, zipName(dist));
  rmSync(out, { force: true });
  run('zip', ['-r', '-X', '-q', out, '.'], { cwd: dist });
  console.log(`build:zip: ${out} (${Math.round(statSync(out).size / 1024)} KB). Unzip it, open chrome://extensions, Developer mode, Load unpacked.`);
}
