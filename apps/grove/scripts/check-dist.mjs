// Checks that dist/ can be dropped into the extension as grove.html (D-11):
// relative asset paths, no inline scripts, nothing the extension CSP
// (script-src 'self') would block. Runs after every build.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const errors = [];
const warnings = [];

if (!existsSync(join(dist, 'index.html'))) {
  console.error('check-dist: dist/index.html not found. Run the build first.');
  process.exit(1);
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');

for (const [tag, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
  if (!src) errors.push(`inline <script> (blocked by the extension CSP): ${tag.slice(0, 60)}…`);
  else if (/^(https?:)?\/\//i.test(src)) errors.push(`remote script: ${src}`);
  else if (src.startsWith('/')) errors.push(`script path is not relative: ${src}`);
  if (src && body.trim()) errors.push(`script with both src and inline code: ${src}`);
}

for (const [, attrs] of html.matchAll(/<link\b([^>]*)>/gi)) {
  const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
  const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? '';
  if (!href || href.startsWith('data:')) continue;
  if (/^(https?:)?\/\//i.test(href)) {
    if (rel.includes('modulepreload')) errors.push(`remote module preload: ${href}`);
    else if (rel.includes('stylesheet')) warnings.push(`remote stylesheet (needs network): ${href}`);
  } else if (href.startsWith('/')) {
    errors.push(`link path is not relative: ${href}`);
  }
}

if (/\son[a-z]+\s*=\s*["']/i.test(html)) errors.push('inline event handler attribute in index.html');

const assets = join(dist, 'assets');
for (const file of existsSync(assets) ? readdirSync(assets) : []) {
  if (!file.endsWith('.js')) continue;
  const code = readFileSync(join(assets, file), 'utf8');
  if (/\beval\s*\(/.test(code)) errors.push(`${file}: eval() is blocked by the extension CSP`);
  if (/new\s+Function\s*\(/.test(code)) {
    errors.push(`${file}: new Function() is blocked by the extension CSP`);
  }
}

for (const warning of warnings) console.warn(`check-dist: warning: ${warning}`);
if (errors.length > 0) {
  for (const error of errors) console.error(`check-dist: ${error}`);
  process.exit(1);
}
console.log('check-dist: dist/ is extension-safe (relative paths, no inline or remote scripts).');
