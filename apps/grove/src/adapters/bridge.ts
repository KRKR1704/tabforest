import {
  MessageType,
  BridgeResponse,
  WorkItemsData,
  OpenTabPayload,
  CloseTabsPayload,
  RestorePayload,
  GetUrlsPayload,
  PausePayload,
  ExcludeDomainPayload,
} from '../types/bridge';
import { mockSnapshot } from '../mocks/mockData';

declare const chrome: any;

// Mock state for local stand-in browser environment
let mockToken: string | null = 'dev-test-token-jwt-user-5d0a';
let mockSignedIn = true;
let mockPausedUntil: string | null = null;
let mockExcludedDomains: string[] = ['chase.com', 'bankofamerica.com', 'fidelity.com'];
let mockHollowCount = 3;
let mockWorkItems: WorkItemsData['items'] = [
  {
    id: 'wi-1',
    title: 'Teams Transcript - Architecture Sync',
    source_type: 'paste',
    text: '[00:14:32] Lead Architect: We decided to deploy the ingestion workers on Azure Functions Consumption tier for v1, while keeping the primary API on Linux App Service.',
    captured_at: '2026-10-04T14:15:00Z',
  },
  {
    id: 'wi-2',
    title: 'Jira CAM-142 Migration Blocker',
    source_type: 'selection',
    text: 'Status: Blocked. Production service principal credentials have not been approved by Infosec.',
    captured_at: '2026-10-04T14:18:00Z',
  },
];

export const isExtensionEnvironment = (): boolean => {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime !== 'undefined' &&
    typeof chrome.runtime.sendMessage === 'function' &&
    Boolean(chrome.runtime.id)
  );
};

export async function sendBridgeMessage<TPayload = unknown, TResponse = unknown>(
  type: MessageType,
  payload?: TPayload
): Promise<BridgeResponse<TResponse>> {
  // If running inside Chrome Extension with active runtime
  if (isExtensionEnvironment()) {
    try {
      const response = await new Promise<BridgeResponse<TResponse>>((resolve, reject) => {
        // contracts/bridge.types.ts: payload fields sit next to `type`, not nested.
        chrome.runtime.sendMessage({ type, ...(payload ?? {}) }, (res: any) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          resolve(res);
        });
      });
      return response;
    } catch (err: any) {
      console.warn(`[Bridge] Extension message ${type} failed, using mock fallback:`, err.message);
    }
  }

  // Stand-in Mock Bridge Handler (C8)
  return handleMockBridgeMessage<TPayload, TResponse>(type, payload);
}

function handleMockBridgeMessage<TPayload, TResponse>(
  type: MessageType,
  payload?: TPayload
): BridgeResponse<TResponse> {
  switch (type) {
    case 'GET_SNAPSHOT':
      return { ok: true, data: mockSnapshot as TResponse };

    case 'OPEN_TAB': {
      const { tab_ref } = (payload || {}) as OpenTabPayload;
      const tab = mockSnapshot.open_tabs.find((t) => t.tab_ref === tab_ref);
      if (tab) {
        window.open(`https://${tab.domain}`, '_blank');
      }
      return { ok: true, data: { tab_ref, opened: true } as TResponse };
    }

    case 'CLOSE_TABS': {
      const { tab_refs } = (payload || { tab_refs: [] }) as CloseTabsPayload;
      console.log('[Mock Bridge] Closed tabs on explicit click:', tab_refs);
      return { ok: true, data: { closed_count: tab_refs.length } as TResponse };
    }

    case 'RESTORE': {
      const { tab_refs = [], fallback_urls = [] } = (payload || {}) as RestorePayload;
      // The stand-in has no URL store, so it opens the saved URL, or the tab's site.
      tab_refs.forEach((ref, index) => {
        const tab = mockSnapshot.open_tabs.find((t) => t.tab_ref === ref);
        const url = fallback_urls[index] || (tab ? `https://${tab.domain}` : '');
        if (url) window.open(url, '_blank');
      });
      return { ok: true, data: null as TResponse };
    }

    case 'GET_URLS': {
      const { tab_refs } = (payload || { tab_refs: [] }) as GetUrlsPayload;
      const urls: Record<string, string> = {};
      tab_refs.forEach((ref) => {
        const tab = mockSnapshot.open_tabs.find((t) => t.tab_ref === ref);
        if (tab) urls[ref] = `https://${tab.domain}/page`;
      });
      return { ok: true, data: { urls } as TResponse };
    }

    case 'SIGN_IN':
      mockSignedIn = true;
      mockToken = 'dev-test-token-jwt-user-5d0a';
      return {
        ok: true,
        data: {
          signed_in: true,
          user_id: 'usr-5d0a-9b1e-3f4a',
          display_name: 'Maya Lin',
          email: 'maya@tabforest.local',
        } as TResponse,
      };

    case 'SIGN_OUT':
      mockSignedIn = false;
      mockToken = null;
      return { ok: true, data: { signed_in: false } as TResponse };

    case 'GET_AUTH_STATE':
      return {
        ok: true,
        data: {
          signed_in: mockSignedIn,
          user_id: mockSignedIn ? 'usr-5d0a-9b1e-3f4a' : undefined,
          display_name: mockSignedIn ? 'Maya Lin' : undefined,
          email: mockSignedIn ? 'maya@tabforest.local' : undefined,
        } as TResponse,
      };

    case 'GET_TOKEN':
      return { ok: true, data: { token: mockToken } as TResponse };

    case 'PAUSE': {
      const { until } = (payload || {}) as PausePayload;
      mockPausedUntil = until || null;
      return { ok: true, data: { paused_until: mockPausedUntil } as TResponse };
    }

    case 'EXCLUDE_DOMAIN': {
      const { domain } = (payload || {}) as ExcludeDomainPayload;
      if (domain && !mockExcludedDomains.includes(domain)) {
        mockExcludedDomains.push(domain);
      }
      return { ok: true, data: { excluded_domains: mockExcludedDomains } as TResponse };
    }

    case 'GET_HOLLOW_COUNT':
      return { ok: true, data: { count: mockHollowCount } as TResponse };

    case 'GET_SEND_PREVIEW':
      return {
        ok: true,
        data: {
          pending_count: 5,
          oldest_event_ts: '2026-10-04T14:28:00Z',
          sample_events: [
            {
              event_id: 'ev-1',
              event_type: 'FOCUS',
              domain: 'fastapi.tiangolo.com',
              ts: '2026-10-04T14:28:10Z',
            },
            {
              event_id: 'ev-2',
              event_type: 'OPEN',
              domain: 'jwt.io',
              ts: '2026-10-04T14:28:40Z',
            },
          ],
        } as TResponse,
      };

    case 'GET_WORK_ITEMS':
      return { ok: true, data: { items: mockWorkItems } as TResponse };

    case 'CLEAR_WORK_ITEMS':
      mockWorkItems = [];
      return { ok: true, data: { cleared: true } as TResponse };

    case 'WIPE_LOCAL':
      mockToken = null;
      mockSignedIn = false;
      mockWorkItems = [];
      return { ok: true, data: { wiped: true } as TResponse };

    default:
      return { ok: false, error: `Unknown message type: ${type}` };
  }
}
