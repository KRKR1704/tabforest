// Work Context analyze (JSON) and upload (multipart), connection C6. Only what
// the user explicitly handed over is ever sent (SPEC §3.5).
import workContextContract from '@contracts/work-context.example.json';
import type { WorkContextOutcome, WorkContextResponse, WorkItem, WorkItemInput } from '../types';
import { apiBaseUrl, authHeaders, isMockMode } from './grove';

export const MAX_ITEM_CHARS = 12_000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = ['.pdf', '.txt', '.md', '.vtt'] as const;

/** The contract's sample reconstruction (the fictional Contoso migration). */
export const SAMPLE_WORK_CONTEXT = workContextContract.examples[0].response
  .body as unknown as WorkContextResponse;

function cap(text: string): string {
  return text.length > MAX_ITEM_CHARS ? text.slice(0, MAX_ITEM_CHARS) : text;
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Captured pages and a pasted note, in the request's shape. A page is sent with
 * its domain only: its full URL stays on the device. A capture whose site is
 * unknown goes as pasted text, since a page must name its domain.
 */
export function toWorkItems(
  captured: WorkItem[],
  paste: { title: string; text: string } | null
): WorkItemInput[] {
  const items: WorkItemInput[] = [];
  for (const item of captured) {
    if (!item.text.trim()) continue;
    const domain =
      item.source_type === 'selection' || item.source_type === 'page_text' ? hostOf(item.url) : null;
    items.push(
      domain
        ? { kind: 'page', title: item.title, domain, text: cap(item.text) }
        : { kind: 'paste', title: item.title, text: cap(item.text) }
    );
  }
  if (paste && paste.text.trim()) {
    items.push({ kind: 'paste', title: paste.title.trim() || 'Pasted notes', text: cap(paste.text) });
  }
  return items;
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Why a file cannot be uploaded, in the server's own terms, or null when it can. */
export function fileProblem(file: { name: string; size: number }): string | null {
  const dot = file.name.lastIndexOf('.');
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(extension)) {
    return `${file.name} is not a PDF, TXT, Markdown or VTT file`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `${file.name} is ${megabytes(file.size)}; the limit is 5 MB per file`;
  }
  return null;
}

async function send(path: string, init: RequestInit): Promise<WorkContextOutcome> {
  try {
    const res = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), ...(await authHeaders()) },
    });
    if (!res.ok) {
      // Errors are RFC 7807 problem JSON; its detail is written for the user.
      let detail: string | undefined;
      try {
        detail = ((await res.json()) as { detail?: string }).detail;
      } catch {
        detail = undefined;
      }
      return { ok: false, message: detail || `The server could not reconstruct this (${res.status}).` };
    }
    return { ok: true, result: (await res.json()) as WorkContextResponse, sample: false };
  } catch (err) {
    console.warn('[WorkContext Adapter] request failed, showing the sample:', err);
    return { ok: true, result: SAMPLE_WORK_CONTEXT, sample: true };
  }
}

/** POST /api/work-context/analyze with `{ items }`. */
export async function analyzeWorkContext(items: WorkItemInput[]): Promise<WorkContextOutcome> {
  if (items.length === 0) return { ok: false, message: 'Add a page, a file or a note first.' };
  if (isMockMode()) return { ok: true, result: SAMPLE_WORK_CONTEXT, sample: false };
  return send('/api/work-context/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
}

/**
 * POST /api/work-context/upload: `files[]` plus, when there are other items,
 * `items_json` holding the same items array as analyze. The browser sets the
 * multipart boundary, so no Content-Type is given here.
 */
export async function uploadWorkContext(
  files: File[],
  items: WorkItemInput[] = []
): Promise<WorkContextOutcome> {
  const problem = files.map(fileProblem).find((message) => message !== null);
  if (problem) return { ok: false, message: problem };
  if (files.length === 0) return analyzeWorkContext(items);
  if (isMockMode()) return { ok: true, result: SAMPLE_WORK_CONTEXT, sample: false };

  const form = new FormData();
  for (const file of files) form.append('files[]', file, file.name);
  if (items.length > 0) form.append('items_json', JSON.stringify(items));
  return send('/api/work-context/upload', { method: 'POST', body: form });
}
