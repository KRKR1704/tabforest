// Work contexts the user chose to keep, on this device. Only the reconstruction
// is stored (claims and their quotes); the page text that was handed over is not
// (SPEC §6.1).
import type { WorkContextResponse } from '../types';

const KEY = 'tabforest:work-contexts';
const LIMIT = 20;

export interface SavedWorkContext {
  id: string;
  saved_at: string;
  result: WorkContextResponse;
}

function read(): SavedWorkContext[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedWorkContext =>
        typeof item?.id === 'string' && typeof item?.result?.project === 'string'
    );
  } catch {
    return [];
  }
}

function write(items: SavedWorkContext[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Full or blocked storage must never break the screen.
  }
}

export function listSavedWorkContexts(): SavedWorkContext[] {
  return read();
}

/** Saves a reconstruction, newest first; saving the same run again replaces it. */
export function saveWorkContext(result: WorkContextResponse): SavedWorkContext[] {
  const entry: SavedWorkContext = {
    id: result.run_id,
    saved_at: new Date().toISOString(),
    result,
  };
  const items = [entry, ...read().filter((item) => item.id !== entry.id)].slice(0, LIMIT);
  write(items);
  return items;
}

export function removeSavedWorkContext(id: string): SavedWorkContext[] {
  const items = read().filter((item) => item.id !== id);
  write(items);
  return items;
}

export function clearSavedWorkContexts(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
