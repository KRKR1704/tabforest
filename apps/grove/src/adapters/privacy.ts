// Privacy settings and deletion (connection C7): contracts/privacy.example.json
// and the delete_account example in contracts/me.example.json.
//
// Unlike the read-only screens, nothing here falls back to stand-in data when
// the API fails: showing settings that are not the user's, or reporting a
// delete that did not happen, would be worse than saying it failed.
import meContract from '@contracts/me.example.json';
import privacyContract from '@contracts/privacy.example.json';
import { apiBaseUrl, authHeaders, isMockMode } from './grove';

export type RetentionDays = 7 | 30 | 90;
export const RETENTION_OPTIONS: RetentionDays[] = [7, 30, 90];

export interface PrivacySettings {
  excluded_domains: string[];
  /** Null: capturing. A time: paused until then. The year 9999: paused until resumed. */
  paused_until: string | null;
  retention_days: RetentionDays;
  cloud_ai_enabled: boolean;
  updated_at: string;
}

/** PATCH /api/privacy changes only the fields it is sent. */
export interface PrivacyPatch {
  excluded_domains_add?: string[];
  excluded_domains_remove?: string[];
  paused_until?: string | null;
  retention_days?: RetentionDays;
  cloud_ai_enabled?: boolean;
}

export interface DeleteResult {
  /** Rows removed, per table. */
  deleted: Record<string, number>;
  total: number;
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; message: string };

const example = <T>(contract: { examples: Array<{ name: string; response: { body: unknown } }> }, name: string): T => {
  const found = contract.examples.find((item) => item.name === name);
  if (!found) throw new Error(`contract has no example "${name}"`);
  return found.response.body as T;
};

const DEFAULTS = example<PrivacySettings>(privacyContract, 'get_defaults');
const DELETED_FOREST = example<DeleteResult & { project_id: string }>(privacyContract, 'delete_forest');
const DELETED_ACCOUNT = example<DeleteResult>(meContract, 'delete_account');

// The stand-in server's copy of the settings, for running without a backend.
let standIn: PrivacySettings = { ...DEFAULTS };

export function resetPrivacyStandIn(): void {
  standIn = { ...DEFAULTS };
}

function standInPatch(patch: PrivacyPatch): PrivacySettings {
  const domains = new Set(standIn.excluded_domains);
  for (const domain of patch.excluded_domains_add ?? []) domains.add(domain);
  for (const domain of patch.excluded_domains_remove ?? []) domains.delete(domain);
  standIn = {
    ...standIn,
    excluded_domains: [...domains],
    ...(patch.paused_until !== undefined ? { paused_until: patch.paused_until } : {}),
    ...(patch.retention_days !== undefined ? { retention_days: patch.retention_days } : {}),
    ...(patch.cloud_ai_enabled !== undefined ? { cloud_ai_enabled: patch.cloud_ai_enabled } : {}),
    updated_at: new Date().toISOString(),
  };
  return standIn;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<Outcome<T>> {
  try {
    const res = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(await authHeaders()),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      // Errors are RFC 7807 problem JSON; its detail is written for the user.
      let detail: string | undefined;
      try {
        detail = ((await res.json()) as { detail?: string }).detail;
      } catch {
        detail = undefined;
      }
      return { ok: false, message: detail || `The server answered ${res.status}.` };
    }
    return { ok: true, value: (await res.json()) as T };
  } catch (err) {
    console.warn(`[Privacy Adapter] ${method} ${path} failed:`, err);
    return { ok: false, message: 'The server could not be reached.' };
  }
}

/** GET /api/privacy. */
export async function getPrivacy(): Promise<Outcome<PrivacySettings>> {
  if (isMockMode()) return { ok: true, value: standIn };
  return call<PrivacySettings>('GET', '/api/privacy');
}

/** PATCH /api/privacy. Returns the full settings as they now stand. */
export async function patchPrivacy(patch: PrivacyPatch): Promise<Outcome<PrivacySettings>> {
  if (isMockMode()) return { ok: true, value: standInPatch(patch) };
  return call<PrivacySettings>('PATCH', '/api/privacy', patch);
}

/** DELETE /api/projects/{id}: "Delete forest". Removes the project and everything derived from it. */
export async function deleteForest(projectId: string): Promise<Outcome<DeleteResult>> {
  if (isMockMode()) {
    return {
      ok: true,
      value:
        projectId === DELETED_FOREST.project_id
          ? { deleted: DELETED_FOREST.deleted, total: DELETED_FOREST.total }
          : { deleted: { projects: 1 }, total: 1 },
    };
  }
  return call<DeleteResult>('DELETE', `/api/projects/${encodeURIComponent(projectId)}`);
}

/** DELETE /api/me: "Delete all memory". Every row the user owns, in one transaction. */
export async function deleteAccount(): Promise<Outcome<DeleteResult>> {
  if (isMockMode()) {
    resetPrivacyStandIn();
    return { ok: true, value: DELETED_ACCOUNT };
  }
  return call<DeleteResult>('DELETE', '/api/me');
}
