// Memory search and prune suggestions (connection C5).
import memoryContract from '@contracts/memory-search.example.json';
import pruneContract from '@contracts/prune.example.json';
import type { MemorySearchResponse, PruneSuggestionsResponse } from '../types';
import { apiBaseUrl, authHeaders, isMockMode } from './grove';

const FOUND = memoryContract.examples[0].response.body as unknown as MemorySearchResponse;
const SAMPLE_PRUNE = pruneContract.examples[0].response.body as unknown as PruneSuggestionsResponse;

/** Words the stand-in's one remembered project (Backend Scaling, March 12) is about. */
const REMEMBERED = ['session', 'storage', 'redis', 'postgres', 'scaling', 'scale'];

function standInSearch(query: string): MemorySearchResponse {
  const words = query.toLowerCase().split(/\W+/).filter(Boolean);
  if (words.some((word) => REMEMBERED.includes(word))) return { ...FOUND, query };
  // Nothing close enough: say so, never stretch a match (SPEC §3.5).
  return { found: false, query, message: 'No related research found', matches: [] };
}

export type MemoryOutcome =
  | { ok: true; result: MemorySearchResponse }
  | { ok: false; message: string };

/** GET /api/memory/search?q=: "Have I researched this before?" */
export async function searchMemory(query: string): Promise<MemoryOutcome> {
  if (isMockMode('memory')) return { ok: true, result: standInSearch(query) };
  try {
    const res = await fetch(`${apiBaseUrl()}/api/memory/search?q=${encodeURIComponent(query)}`, {
      method: 'GET',
      headers: await authHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true, result: (await res.json()) as MemorySearchResponse };
  } catch (err) {
    // A sample match here would claim research the user never did.
    console.warn('[Memory Adapter] searchMemory failed:', err);
    return { ok: false, message: 'Your memory could not be searched right now.' };
  }
}

export type PruneOutcome =
  | { ok: true; result: PruneSuggestionsResponse }
  | { ok: false; message: string };

/**
 * POST /api/tabs/prune-suggestions with the open tabs' refs. Suggestions lead
 * to closing tabs, so a failure is reported and never replaced by sample data.
 */
export async function getPruneSuggestions(tabRefs: string[]): Promise<PruneOutcome> {
  if (isMockMode('prune')) return { ok: true, result: SAMPLE_PRUNE };
  try {
    const res = await fetch(`${apiBaseUrl()}/api/tabs/prune-suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ tab_refs: tabRefs }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true, result: (await res.json()) as PruneSuggestionsResponse };
  } catch (err) {
    console.warn('[Memory Adapter] getPruneSuggestions failed:', err);
    return { ok: false, message: 'Prune suggestions are unavailable right now.' };
  }
}
