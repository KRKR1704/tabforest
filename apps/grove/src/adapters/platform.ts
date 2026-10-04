import {
  UserProfile,
  BrowserSession,
  TimelineResponse,
  TimelineResult,
  TokenData,
} from '../types';
import {
  mockUserProfile,
  mockSessions,
  mockTimelineResponse,
} from '../mocks/mockData';
import { isMockMode } from './grove';
import { sendBridgeMessage } from './bridge';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

async function getAuthHeader(): Promise<Record<string, string>> {
  const tokenRes = await sendBridgeMessage<void, TokenData>('GET_TOKEN');
  const token = tokenRes.data?.token;
  if (token) return { Authorization: `Bearer ${token}` };
  return { 'X-Dev-User': 'usr-5d0a-9b1e-3f4a' };
}

export async function getMe(): Promise<UserProfile> {
  if (isMockMode()) return mockUserProfile;

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/api/me`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[Platform Adapter] getMe failed, using mock fallback:', err);
    return mockUserProfile;
  }
}

export async function getSessions(): Promise<BrowserSession[]> {
  if (isMockMode()) return mockSessions;

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/api/sessions`, {
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
  if (isMockMode()) {
    return mockSessions.find((s) => s.id === id) || mockSessions[0];
  }

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/api/sessions/${id}`, {
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
  if (isMockMode()) return standInTimeline(projectId, range);

  try {
    const headers = await getAuthHeader();
    const res = await fetch(
      `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/timeline?range=${encodeURIComponent(range)}`,
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
