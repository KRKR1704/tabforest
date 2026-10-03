import {
  MemorySearchResponse,
  PruneSuggestionsResponse,
  TokenData,
} from '../types';
import {
  mockMemorySearchResponse,
  mockPruneSuggestionsResponse,
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

export async function searchMemory(query: string): Promise<MemorySearchResponse> {
  if (isMockMode()) {
    const qLower = query.toLowerCase().trim();
    if (qLower.includes('session') || qLower.includes('auth') || qLower.includes('redis') || qLower.includes('cookie')) {
      return {
        query,
        results: mockMemorySearchResponse.results,
      };
    }
    return {
      query,
      results: [],
      message: 'No related research found in your forest history',
    };
  }

  try {
    const headers = await getAuthHeader();
    const url = new URL(`${API_BASE_URL}/api/memory/search`);
    url.searchParams.set('q', query);

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[Memory Adapter] searchMemory failed, using mock fallback:', err);
    return mockMemorySearchResponse;
  }
}

export async function getPruneSuggestions(): Promise<PruneSuggestionsResponse> {
  if (isMockMode()) {
    return mockPruneSuggestionsResponse;
  }

  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${API_BASE_URL}/api/tabs/prune-suggestions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[Memory Adapter] getPruneSuggestions failed, using mock fallback:', err);
    return mockPruneSuggestionsResponse;
  }
}
