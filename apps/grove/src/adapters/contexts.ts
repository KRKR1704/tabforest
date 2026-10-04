// Saved contexts and resume (connection C7, contracts/saved-context.example.json).
import contextContract from '@contracts/saved-context.example.json';
import { apiBaseUrl, authHeaders, isMockMode } from './grove';
import type { WireClaim, WireMushroom, WireNextAction, WireStone } from './groveContract';

export type ContextKind = 'resume' | 'references';
export type ExcludedReason = 'exact_duplicate' | 'semantic_redundant' | 'stale';
export type RestoreOption = 'important' | 'all' | 'summary';

/**
 * What the resume card is built from. The claims are the grove's own claim
 * objects, sent as they are; the server stores them and never re-derives one.
 */
export interface ContextCard {
  goal: WireClaim;
  direction: WireClaim | null;
  decisions: WireStone[];
  explored_branches: Array<{ label: string; status: 'explored' }>;
  unresolved_questions: WireMushroom[];
  next_action: WireNextAction | null;
}

export interface ContextTab {
  tab_ref: string;
  /** Stripped URL from GET_URLS: no query string, no fragment. Absent when the device has none. */
  fallback_url?: string;
  domain: string;
  title: string;
  important: boolean;
  excluded_reason: ExcludedReason | null;
}

export interface SaveContextBody {
  kind: ContextKind;
  title: string;
  card: ContextCard | null;
  tabs: ContextTab[];
}

export interface SavedContextReceipt {
  id: string;
  project_id: string;
  kind: ContextKind;
  title: string;
  saved_at: string;
  important_tab_count: number;
  total_tab_count: number;
}

/** One card on the Saved Groves screen. */
export interface SavedContextRow extends SavedContextReceipt {
  project_name: string;
  last_resumed_at: string | null;
  last_active_at: string;
  active_ms: number;
  session_count: number;
  /** Null when the totals are live; otherwise the time they were recorded. */
  totals_as_of: string | null;
  open_question_count: number;
  goal_summary: string | null;
  next_action: string | null;
}

export interface ResumeTab {
  tab_ref: string;
  fallback_url?: string;
  domain: string;
  title: string;
  importance: number | null;
  excluded_reason?: ExcludedReason | null;
}

export interface ResumeResult {
  id: string;
  project_id: string;
  project_name: string;
  kind: ContextKind;
  title: string;
  saved_at: string;
  last_resumed_at: string | null;
  last_active_at: string;
  active_ms: number;
  session_count: number;
  totals_as_of: string | null;
  card: ContextCard | null;
  important_tabs: ResumeTab[];
  other_tabs: ResumeTab[];
  restore_options: RestoreOption[];
}

export interface ContextList {
  contexts: SavedContextRow[];
  /** True when these are the contract's sample rows, shown because the API could not be reached. */
  sample: boolean;
}

const example = (name: string) => {
  const found = contextContract.examples.find((item) => item.name === name);
  if (!found) throw new Error(`saved-context contract has no example "${name}"`);
  return found;
};

const CONTRACT_ROWS = (example('list_contexts').response.body as unknown as { contexts: SavedContextRow[] })
  .contexts;
const CONTRACT_RESUME = example('resume_next_morning').response.body as unknown as ResumeResult;

// The stand-in server keeps what was saved in this page's memory, so a context
// saved offline can be listed and resumed until the page reloads.
let standInRows: SavedContextRow[] = [...CONTRACT_ROWS];
let standInSaved = new Map<string, { projectId: string; body: SaveContextBody }>();

export function resetContextStandIn(): void {
  standInRows = [...CONTRACT_ROWS];
  standInSaved = new Map();
}

/** A URL may reach the server only without its query string and fragment (SPEC §6.1). */
export function stripUrl(url: string): string {
  return url.split(/[?#]/)[0];
}

function sanitize(body: SaveContextBody): SaveContextBody {
  return {
    ...body,
    tabs: body.tabs.map((tab) =>
      tab.fallback_url ? { ...tab, fallback_url: stripUrl(tab.fallback_url) } : tab
    ),
  };
}

function standInSave(projectId: string, body: SaveContextBody): SavedContextReceipt {
  const id = `s_local-${Date.now().toString(36)}-${standInSaved.size + 1}`;
  const savedAt = new Date().toISOString();
  const receipt: SavedContextReceipt = {
    id,
    project_id: projectId,
    kind: body.kind,
    title: body.title,
    saved_at: savedAt,
    important_tab_count: body.tabs.filter((tab) => tab.important).length,
    total_tab_count: body.tabs.length,
  };
  standInSaved.set(id, { projectId, body });
  standInRows = [
    {
      ...receipt,
      project_name: body.title,
      last_resumed_at: null,
      last_active_at: savedAt,
      active_ms: 0,
      session_count: 1,
      totals_as_of: savedAt,
      open_question_count: body.card?.unresolved_questions.length ?? 0,
      goal_summary: body.card?.goal.text ?? null,
      next_action: body.card?.next_action?.text ?? null,
    },
    ...standInRows,
  ];
  return receipt;
}

function standInResume(id: string): ResumeResult | null {
  if (id === CONTRACT_RESUME.id) return CONTRACT_RESUME;
  const row = standInRows.find((item) => item.id === id);
  const saved = standInSaved.get(id);
  if (!row || !saved) return null;
  const toResume = (tab: ContextTab): ResumeTab => ({
    tab_ref: tab.tab_ref,
    fallback_url: tab.fallback_url,
    domain: tab.domain,
    title: tab.title,
    importance: null,
    excluded_reason: tab.excluded_reason,
  });
  return {
    ...row,
    last_resumed_at: new Date().toISOString(),
    card: saved.body.card,
    important_tabs: saved.body.tabs.filter((tab) => tab.important).map(toResume),
    other_tabs: saved.body.tabs.filter((tab) => !tab.important).map(toResume),
    restore_options: ['important', 'all', 'summary'],
  };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(await authHeaders()),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * POST /api/projects/{id}/save-context. A failed save throws: pretending a
 * context was stored would lose the user's work the moment they close the tabs.
 */
export async function saveContext(
  projectId: string,
  body: SaveContextBody
): Promise<SavedContextReceipt> {
  const clean = sanitize(body);
  if (isMockMode()) return standInSave(projectId, clean);
  return request<SavedContextReceipt>(
    'POST',
    `/api/projects/${encodeURIComponent(projectId)}/save-context`,
    clean
  );
}

/** GET /api/contexts. */
export async function listContexts(): Promise<ContextList> {
  if (isMockMode()) return { contexts: standInRows, sample: false };
  try {
    const data = await request<{ contexts: SavedContextRow[] }>('GET', '/api/contexts');
    return { contexts: data.contexts ?? [], sample: false };
  } catch (err) {
    console.warn('[Contexts Adapter] listContexts failed, showing sample rows:', err);
    return { contexts: standInRows, sample: true };
  }
}

/** POST /api/contexts/{id}/resume (no body). Null when the context cannot be resumed. */
export async function resumeContext(id: string): Promise<ResumeResult | null> {
  if (isMockMode()) return standInResume(id);
  try {
    return await request<ResumeResult>('POST', `/api/contexts/${encodeURIComponent(id)}/resume`);
  } catch (err) {
    console.warn('[Contexts Adapter] resumeContext failed, trying the stand-in:', err);
    return standInResume(id);
  }
}
