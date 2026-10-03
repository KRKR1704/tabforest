import { create } from 'zustand';
import { AuthStateData, SendPreviewData, WorkItem } from '../types';
import { sendBridgeMessage, isExtensionEnvironment } from '../adapters/bridge';

interface BridgeStoreState {
  isConnectedToExtension: boolean;
  authState: AuthStateData;
  token: string | null;
  hollowCount: number;
  sendPreview: SendPreviewData | null;
  workItems: WorkItem[];
  isLoading: boolean;

  // Actions
  initializeBridge: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  fetchHollowCount: () => Promise<void>;
  fetchSendPreview: () => Promise<void>;
  fetchWorkItems: () => Promise<void>;
  clearWorkItems: () => Promise<void>;
  pauseCapture: (until: string | null) => Promise<void>;
  excludeDomain: (domain: string) => Promise<void>;
  wipeLocal: () => Promise<void>;
}

export const useBridgeStore = create<BridgeStoreState>((set) => ({
  isConnectedToExtension: false,
  authState: { signed_in: true, user_id: 'usr-5d0a-9b1e-3f4a', display_name: 'Maya Lin', email: 'maya@tabforest.local' },
  token: 'dev-test-token-jwt-user-5d0a',
  hollowCount: 3,
  sendPreview: null,
  workItems: [],
  isLoading: false,

  initializeBridge: async () => {
    const isExt = isExtensionEnvironment();
    set({ isConnectedToExtension: isExt });

    const [authRes, tokenRes, hollowRes] = await Promise.all([
      sendBridgeMessage<void, AuthStateData>('GET_AUTH_STATE'),
      sendBridgeMessage<void, { token: string | null }>('GET_TOKEN'),
      sendBridgeMessage<void, { count: number }>('GET_HOLLOW_COUNT'),
    ]);

    if (authRes.ok && authRes.data) {
      set({ authState: authRes.data });
    }
    if (tokenRes.ok && tokenRes.data) {
      set({ token: tokenRes.data.token });
    }
    if (hollowRes.ok && hollowRes.data) {
      set({ hollowCount: hollowRes.data.count });
    }
  },

  signIn: async () => {
    set({ isLoading: true });
    const res = await sendBridgeMessage<void, AuthStateData>('SIGN_IN');
    if (res.ok && res.data) {
      set({ authState: res.data });
      const tokenRes = await sendBridgeMessage<void, { token: string | null }>('GET_TOKEN');
      if (tokenRes.ok && tokenRes.data) {
        set({ token: tokenRes.data.token });
      }
    }
    set({ isLoading: false });
  },

  signOut: async () => {
    set({ isLoading: true });
    await sendBridgeMessage('SIGN_OUT');
    set({
      authState: { signed_in: false },
      token: null,
      isLoading: false,
    });
  },

  fetchHollowCount: async () => {
    const res = await sendBridgeMessage<void, { count: number }>('GET_HOLLOW_COUNT');
    if (res.ok && res.data) {
      set({ hollowCount: res.data.count });
    }
  },

  fetchSendPreview: async () => {
    const res = await sendBridgeMessage<void, SendPreviewData>('GET_SEND_PREVIEW');
    if (res.ok && res.data) {
      set({ sendPreview: res.data });
    }
  },

  fetchWorkItems: async () => {
    const res = await sendBridgeMessage<void, { items: WorkItem[] }>('GET_WORK_ITEMS');
    if (res.ok && res.data) {
      set({ workItems: res.data.items });
    }
  },

  clearWorkItems: async () => {
    const res = await sendBridgeMessage('CLEAR_WORK_ITEMS');
    if (res.ok) {
      set({ workItems: [] });
    }
  },

  pauseCapture: async (until: string | null) => {
    await sendBridgeMessage('PAUSE', { until });
  },

  excludeDomain: async (domain: string) => {
    await sendBridgeMessage('EXCLUDE_DOMAIN', { domain });
  },

  wipeLocal: async () => {
    await sendBridgeMessage('WIPE_LOCAL');
    set({
      token: null,
      authState: { signed_in: false },
      workItems: [],
    });
  },
}));
