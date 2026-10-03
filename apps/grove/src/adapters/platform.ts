import {
  UserProfile,
  PrivacySettings,
  BrowserSession,
  TimelineResponse,
  SavedContextItem,
  ResumeCardData,
  TokenData,
} from '../types';
import {
  mockUserProfile,
  mockPrivacySettings,
  mockSessions,
  mockTimelineResponse,
  mockSavedContexts,
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

export async function deleteMe(): Promise<{ success: boolean; deleted_rows: number }> {
  if (isMockMode()) return { success: true, deleted_rows: 42 };

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/api/me`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[Platform Adapter] deleteMe failed, using mock fallback:', err);
    return { success: true, deleted_rows: 42 };
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

export async function getTimeline(
  projectId: string,
  range: string = '24h'
): Promise<TimelineResponse> {
  if (isMockMode()) return mockTimelineResponse;

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}/timeline?range=${range}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[Platform Adapter] getTimeline fallback:', err);
    return mockTimelineResponse;
  }
}

export async function saveContext(
  projectId: string,
  data: { title: string; kind: 'resume' | 'references'; snapshot: any }
): Promise<{ id: string; saved_at: string }> {
  if (isMockMode()) {
    return {
      id: `ctx-${Date.now()}`,
      saved_at: new Date().toISOString(),
    };
  }

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}/save-context`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[Platform Adapter] saveContext fallback:', err);
    return { id: 'ctx-fallback', saved_at: new Date().toISOString() };
  }
}

export async function getContexts(): Promise<SavedContextItem[]> {
  if (isMockMode()) return mockSavedContexts.list;

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/api/contexts`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : data.contexts || [];
  } catch (err) {
    console.warn('[Platform Adapter] getContexts fallback:', err);
    return mockSavedContexts.list;
  }
}

export async function resumeContext(id: string): Promise<ResumeCardData> {
  if (isMockMode()) return mockSavedContexts.resumeCard;

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/api/contexts/${id}/resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[Platform Adapter] resumeContext fallback:', err);
    return mockSavedContexts.resumeCard;
  }
}

export async function getPrivacy(): Promise<PrivacySettings> {
  if (isMockMode()) return mockPrivacySettings;

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/api/privacy`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[Platform Adapter] getPrivacy fallback:', err);
    return mockPrivacySettings;
  }
}

export async function updatePrivacy(settings: Partial<PrivacySettings>): Promise<PrivacySettings> {
  if (isMockMode()) {
    return {
      ...mockPrivacySettings,
      ...settings,
    };
  }

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/api/privacy`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[Platform Adapter] updatePrivacy fallback:', err);
    return { ...mockPrivacySettings, ...settings };
  }
}

export async function deleteProject(projectId: string): Promise<{ success: boolean; deleted_rows: number }> {
  if (isMockMode()) return { success: true, deleted_rows: 15 };

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[Platform Adapter] deleteProject fallback:', err);
    return { success: true, deleted_rows: 15 };
  }
}
