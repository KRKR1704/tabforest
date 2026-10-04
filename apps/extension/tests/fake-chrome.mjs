import { vi } from 'vitest';

function event() {
  const listeners = [];
  return { addListener: fn => listeners.push(fn), fire: (...args) => listeners.forEach(fn => fn(...args)) };
}

export function fakeStorage() {
  const area = () => {
    const data = {};
    return { data, get: vi.fn(async key => structuredClone({ [key]: data[key] })),
      set: vi.fn(async items => Object.assign(data, structuredClone(items))) };
  };
  return { session: area(), local: area() };
}

export function fakeChrome(initialTabs = [], initialWindow = { id: 1, focused: true }, storage = fakeStorage()) {
  const tabs = new Map(initialTabs.map(tab => [tab.id, { ...tab }]));
  const api = {
    storage,
    tabs: {
      onCreated: event(), onActivated: event(), onUpdated: event(), onRemoved: event(),
      get: vi.fn(async id => {
        if (!tabs.has(id)) throw new Error('Tab was closed');
        return { ...tabs.get(id) };
      }),
      query: vi.fn(async query => [...tabs.values()].filter(tab =>
        (query.active === undefined || tab.active === query.active) &&
        (query.windowId === undefined || tab.windowId === query.windowId)).map(tab => ({ ...tab }))),
      create: vi.fn(),
    },
    windows: { WINDOW_ID_NONE: -1, onFocusChanged: event(), getLastFocused: vi.fn(async () => initialWindow) },
    idle: { onStateChanged: event(), setDetectionInterval: vi.fn(), queryState: vi.fn(async () => 'active') },
    runtime: { onInstalled: event(), onStartup: event(), getURL: path => `chrome-extension://test/${path}` },
    action: { onClicked: event() },
  };
  return { api, tabs };
}

export const tab = (id, extra = {}) => ({
  id, windowId: 1, url: `https://example.com/page-${id}`, title: `Page ${id}`,
  active: false, pinned: false, lastAccessed: id, ...extra,
});
