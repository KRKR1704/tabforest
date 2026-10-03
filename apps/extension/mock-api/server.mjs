import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const keyDoc = readFileSync(new URL('../EXTENSION_KEY.md', import.meta.url), 'utf8');
export const defaultOrigin = keyDoc.match(/Origin: `(chrome-extension:\/\/[a-p]{32})`/)[1];

function containsUserId(value) {
  return value !== null && typeof value === 'object' && (
    Object.hasOwn(value, 'user_id') || Object.values(value).some(containsUserId)
  );
}

export function createMockServer(allowedOrigin = process.env.ALLOWED_EXTENSION_ORIGIN ?? defaultOrigin) {
  const seen = new Set();
  return createServer(async (req, res) => {
    res.setHeader('Vary', 'Origin');
    if (req.headers.origin === allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(req.headers.origin === allowedOrigin ? 204 : 403);
      res.end();
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      reply(200, { status: 'ok' });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/api/events') {
      reply(404, { detail: 'Not found' });
      return;
    }
    let body;
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      body = JSON.parse(raw);
    } catch {
      reply(422, { detail: 'Expected a JSON batch' });
      return;
    }
    if (containsUserId(body) || !Array.isArray(body?.events) || body.events.length > 500 ||
        body.events.some(event => !event || typeof event.event_id !== 'string' || !event.event_id)) {
      reply(422, { detail: 'Expected at most 500 events with event_id and no user_id' });
      return;
    }
    let accepted = 0;
    let duplicates = 0;
    for (const event of body.events) {
      if (seen.has(event.event_id)) duplicates++;
      else {
        seen.add(event.event_id);
        accepted++;
      }
    }
    reply(202, { accepted, duplicates });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createMockServer();
  server.listen(8001, '127.0.0.1', () => console.log('TabForest mock API listening on http://127.0.0.1:8001'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
