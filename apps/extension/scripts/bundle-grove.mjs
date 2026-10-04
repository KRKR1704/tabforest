// D-11: put the Grove UI build (apps/grove/dist) inside the extension build as grove.html.
// Run after `vite build` in apps/extension. The Grove code is never edited here, only copied.
// If the Grove build is missing, the placeholder grove.html is left as it is.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// What is written into the extension: scripts and styles lose their sourcemap comment (the maps are not copied).
function contentFor(file, name) {
  const data = readFileSync(file);
  if (!/\.(js|css)$/.test(name)) return data;
  return Buffer.from(data.toString('utf8').replace(/\n?\/[*/]# sourceMappingURL=\S+(?:\s*\*\/)?\s*$/, '\n'));
}

// The extension CSP is `script-src 'self'`: refuse a build it would break.
function checkHtml(html, groveDist) {
  const problems = [];
  for (const [tag, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!src) problems.push(`inline script: ${tag.slice(0, 60)}`);
    else if (/^(https?:)?\/\//i.test(src)) problems.push(`remote script: ${src}`);
    else if (!src.startsWith('./')) problems.push(`script path is not relative: ${src}`);
    if (src && body.trim()) problems.push(`script with src and inline code: ${src}`);
  }
  if (/\son[a-z]+\s*=\s*["']/i.test(html)) problems.push('inline event handler attribute');
  for (const [, attrs] of html.matchAll(/<(?:script|link)\b([^>]*)>/gi)) {
    const ref = /\b(?:src|href)\s*=\s*["']\.\/([^"']+)["']/i.exec(attrs)?.[1];
    if (ref && !existsSync(join(groveDist, ref))) problems.push(`referenced file is missing: ./${ref}`);
  }
  return problems;
}

export function bundleGrove({ groveDist, extDist, log = console.log }) {
  const indexPath = join(groveDist, 'index.html');
  if (!existsSync(indexPath)) {
    log(`bundle-grove: ${indexPath} not found, keeping the placeholder grove.html`);
    return { bundled: false, reason: 'missing' };
  }
  if (!existsSync(join(extDist, 'manifest.json'))) {
    throw new Error(`bundle-grove: ${extDist}/manifest.json not found; run "pnpm build" in apps/extension first`);
  }
  const html = readFileSync(indexPath, 'utf8');
  const problems = checkHtml(html, groveDist);
  if (problems.length) throw new Error(`bundle-grove: the Grove build is not extension-safe:\n- ${problems.join('\n- ')}`);

  const source = join(groveDist, 'assets');
  const target = join(extDist, 'assets');
  const copies = [];
  for (const name of existsSync(source) ? readdirSync(source) : []) {
    if (name.endsWith('.map')) continue; // sourcemaps are large and not needed in the extension
    const to = join(target, name);
    const data = contentFor(join(source, name), name);
    if (existsSync(to) && !readFileSync(to).equals(data)) {
      throw new Error(`bundle-grove: ${to} already exists with different content; refusing to overwrite it`);
    }
    copies.push([to, data, name]);
  }
  mkdirSync(target, { recursive: true });
  for (const [to, data] of copies) writeFileSync(to, data);
  writeFileSync(join(extDist, 'grove.html'), html);
  log(`bundle-grove: ${copies.length} asset file(s) and grove.html copied into ${extDist}`);
  return { bundled: true, files: copies.map(([, , name]) => name) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = flag => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : undefined; };
  try {
    bundleGrove({
      groveDist: resolve(arg('--grove') ?? join(here, '..', '..', 'grove', 'dist')),
      extDist: resolve(arg('--ext') ?? join(here, '..', 'dist')),
    });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
