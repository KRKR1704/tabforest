export function httpUrl(value?: string): URL | null {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function normalizeUrl(value: string): string {
  const url = httpUrl(value);
  if (!url) throw new Error('Expected an HTTP(S) URL');
  const keys: string[] = [];
  url.searchParams.forEach((_, key) => keys.push(key));
  for (const key of keys) {
    if (/^utm_/i.test(key) || ['fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref'].includes(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  const query = url.searchParams.toString();
  return url.host.replace(/^www\./, '') + url.pathname.replace(/\/$/, '') + (query ? `?${query}` : '');
}

export async function dupKey(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeUrl(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function searchQuery(value: string): string | null {
  const url = httpUrl(value);
  if (!url) return null;
  const host = url.hostname.replace(/^www\./, '');
  // Exact engine hosts avoid treating arbitrary sites containing "google" as search.
  const qEngines = ['google.com', 'bing.com', 'duckduckgo.com', 'search.brave.com', 'ecosia.org'];
  const param = qEngines.includes(host) ? 'q' : host === 'search.yahoo.com' ? 'p' : null;
  return param ? url.searchParams.get(param) : null;
}
