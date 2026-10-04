// D-13: serves the SAMPLE documents (apps/api/app/engine/fixtures/sample_docs) as small web pages on
// http://127.0.0.1:8765/, so the demo can add them to Work Context with the right-click menu.
// Run: node scripts/serve-sample-docs.mjs   (Ctrl+C to stop)
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'api', 'app', 'engine', 'fixtures', 'sample_docs');
const esc = text => text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const names = readdirSync(dir).filter(name => /\.(md|vtt)$/.test(name) && name !== 'README.md');

createServer((req, res) => {
  const name = decodeURIComponent((req.url ?? '/').split('?')[0].slice(1));
  res.setHeader('content-type', 'text/html; charset=utf-8');
  if (!name) {
    res.end(`<!doctype html><title>TabForest sample documents</title><main><h1>Sample documents</h1><ul>${
      names.map(n => `<li><a href="/${encodeURIComponent(n)}">${esc(n)}</a></li>`).join('')}</ul></main>`);
    return;
  }
  if (!names.includes(name)) { res.statusCode = 404; res.end('<!doctype html><title>Not found</title><main>Not found</main>'); return; }
  res.end(`<!doctype html><title>${esc(name)}</title><main><article><pre style="white-space:pre-wrap;font:15px/1.5 system-ui;max-width:760px;margin:2rem auto">${esc(readFileSync(join(dir, name), 'utf8'))}</pre></article></main>`);
}).listen(8765, '127.0.0.1', () => console.log(`Sample documents: http://127.0.0.1:8765/  (${names.length} files)`));
