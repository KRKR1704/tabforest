// Makes a copy of a build with a changed manifest, for the checks that need something Chrome only grants on a click.
//   node variant.mjs <dist> <out> [--host http://localhost/*] [--tabgroups]
// --host       adds a host permission (work-context check: the right-click grants activeTab, a script call does not)
// --tabgroups  makes tabGroups a normal permission (restore check: Playwright cannot press the permission prompt)
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [src, out] = [process.argv[2], process.argv[3]].map(p => p && resolve(p));
if (!src || !out) { console.error('usage: node variant.mjs <dist> <out> [--host <pattern>] [--tabgroups]'); process.exit(1); }
const flag = name => process.argv.indexOf(name);
rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });
const file = join(out, 'manifest.json');
const manifest = JSON.parse(readFileSync(file, 'utf8'));
if (flag('--host') > -1) manifest.host_permissions = [process.argv[flag('--host') + 1]];
if (flag('--tabgroups') > -1) {
  manifest.permissions.push('tabGroups');
  manifest.optional_permissions = (manifest.optional_permissions ?? []).filter(x => x !== 'tabGroups');
}
writeFileSync(file, JSON.stringify(manifest));
console.log(`variant written to ${out}`);
