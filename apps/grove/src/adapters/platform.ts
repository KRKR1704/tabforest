import {
  UserProfile,
  BrowserSession,
  TimelineResponse,
  TimelineResult,
} from '../types';
import {
  mockUserProfile,
  mockSessions,
  mockTimelineResponse,
} from '../mocks/mockData';
import { apiBaseUrl, authHeaders as getAuthHeader } from './grove';
import { isMockMode } from './live';

/** GET /api/me as the server sends it (contracts/me.example.json). */
interface WireMe {
  user: { id: string; display_name: string | null; email: string | null; created_at: string };
  stats: {
    total_forests: number;
    active_goals: number;
    total_attention_ms: number;
    total_resolved_questions: number;
  };
  privacy: UserProfile['privacy'];
}

const MS_PER_HOUR = 3_600_000;

export function normalizeMe(wire: WireMe): UserProfile {
  return {
    id: wire.user.id,
    display_name: wire.user.display_name ?? '',
    email: wire.user.email ?? '',
    created_at: wire.user.created_at,
    privacy: wire.privacy,
    stats: {
      total_forests: wire.stats.total_forests,
      active_goals: wire.stats.active_goals,
      total_attention_hours: Math.round((wire.stats.total_attention_ms / MS_PER_HOUR) * 10) / 10,
      total_resolved_questions: wire.stats.total_resolved_questions,
    },
  };
}

export async function getMe(): Promise<UserProfile> {
  if (isMockMode('me')) return mockUserProfile;

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${apiBaseUrl()}/api/me`, { method: 'GET', headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return normalizeMe((await res.json()) as WireMe);
  } catch (err) {
    console.warn('[Platform Adapter] getMe failed, using mock fallback:', err);
    return mockUserProfile;
  }
}

export async function getSessions(): Promise<BrowserSession[]> {
  if (isMockMode('sessions')) return mockSessions;

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${apiBaseUrl()}/api/sessions`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.sessions || data;
  } catch (err) {
    console.warn('[Platform Adapter] getSessions fallback:', err);
    return mockSessions;
  }
}

export async function getSession(id: string): Promise<BrowserSession> {
  if (isMockMode('sessions')) {
    return mockSessions.find((s) => s.id === id) || mockSessions[0];
  }

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${apiBaseUrl()}/api/sessions/${id}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[Platform Adapter] getSession fallback:', err);
    return mockSessions[0];
  }
}

const DEFAULT_RETRY_MS = 5000;

/** An empty day for a project the stand-in has no story for. */
function emptyTimeline(projectId: string, range: string): TimelineResponse {
  const to = new Date();
  return {
    project_id: projectId,
    name: '',
    range,
    bucket: '30m',
    from: new Date(to.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    to: to.toISOString(),
    lanes: [],
    switches: [],
    markers: [],
    totals: { active_ms: 0, tab_switches: 0, intent_switches: 0, unassigned_switches: 0 },
  };
}

function standInTimeline(projectId: string, range: string): TimelineResult {
  return {
    status: 'ok',
    timeline:
      projectId === mockTimelineResponse.project_id
        ? mockTimelineResponse
        : emptyTimeline(projectId, range),
  };
}

/**
 * GET /api/projects/{id}/timeline?range=24h. A 503 means the memory store is
 * down, which the screen shows as "memory reconnecting" (SPEC §13) rather than
 * hiding behind stand-in data.
 */
export async function getTimeline(
  projectId: string,
  range: string = '24h'
): Promise<TimelineResult> {
  if (isMockMode('timeline')) return standInTimeline(projectId, range);

  try {
    const headers = await getAuthHeader();
    const res = await fetch(
      `${apiBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/timeline?range=${encodeURIComponent(range)}`,
      { method: 'GET', headers }
    );
    if (res.status === 503) {
      const seconds = Number(res.headers?.get?.('Retry-After'));
      return {
        status: 'reconnecting',
        retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_MS,
      };
    }
    if (res.status === 404) return { status: 'not-found' };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { status: 'ok', timeline: (await res.json()) as TimelineResponse };
  } catch (err) {
    console.warn('[Platform Adapter] getTimeline failed, using the stand-in:', err);
    return standInTimeline(projectId, range);
  }
}
