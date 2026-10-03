import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import manifest from '../manifest.config';

test('manifest preserves the exact privacy settings and fixed extension ID', () => {
  expect(manifest.permissions).toEqual(['tabs', 'storage', 'idle', 'identity', 'contextMenus', 'activeTab', 'scripting']);
  expect(manifest.optional_permissions).toEqual(['tabGroups']);
  expect(manifest.incognito).toBe('not_allowed');
  expect(manifest.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'self'");
  expect(manifest).not.toHaveProperty('host_permissions');
  expect(manifest).not.toHaveProperty('content_scripts');
  expect(manifest.key).toBeTruthy();
  const doc = readFileSync(new URL('../EXTENSION_KEY.md', import.meta.url), 'utf8');
  const expectedId = doc.match(/Extension ID: `([a-p]{32})`/)[1];
  expect(manifest.key).toBe(doc.match(/```text\n([^\n]+)/)[1]);
  const id = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex')
    .slice(0, 32).replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
  expect(id).toBe(expectedId);
  expect(manifest.background).toEqual({ service_worker: 'src/background/index.ts', type: 'module' });
});
