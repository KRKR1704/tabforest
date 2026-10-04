// The last finished grove, kept on this device so the page opens instantly and
// still has something true to show when the API is down (SPEC §13). It holds
// what the grove already shows (redacted titles and domains). Never a token.
import type { GroveResponse } from '../types';

const KEY = 'tabforest:last-grove';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // storage can be blocked outright
  }
}

export function saveLastGrove(grove: GroveResponse): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(grove));
  } catch {
    // Full or unavailable storage must never break a grow.
  }
}

export function loadLastGrove(): GroveResponse | null {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GroveResponse>;
    if (!parsed || !Array.isArray(parsed.trees) || !parsed.meadow || !Array.isArray(parsed.sprouts)) {
      return null;
    }
    return parsed as GroveResponse;
  } catch {
    return null;
  }
}

export function clearLastGrove(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
