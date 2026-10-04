import type { FocusState } from './focus-tracker';
import type { TabSnapshotItem } from '../../../../contracts/bridge.types';

// C6 allows null titles; shared draft currently declares string only.
export type SnapshotItem = Omit<TabSnapshotItem, 'title'> & { title: string | null };

export const SESSION_KEY = 'tf_capture_session';
export const URLS_KEY = 'tf_capture_urls';

export interface SessionState {
  refs: [number, string][];
  openedRefs: string[];
  snapshotItems?: [string, SnapshotItem][];
  hollowTabs: number[];
  eligible: number[];
  focus: FocusState;
  previousTabRef: string | null;
  lastSeenAt: number;
}

interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** Inject Chrome storage or a fake; never put browser-session IDs in local. */
export class CaptureStateStore {
  constructor(private readonly storage: { session: StorageArea; local: StorageArea }) {}

  async load(): Promise<{ session: SessionState | null; urls: [string, string][] }> {
    const [session, local] = await Promise.all([
      this.storage.session.get(SESSION_KEY), this.storage.local.get(URLS_KEY),
    ]);
    return {
      session: (session[SESSION_KEY] as SessionState | undefined) ?? null,
      urls: (local[URLS_KEY] as [string, string][] | undefined) ?? [],
    };
  }

  // The capture callback chain awaits each save before allowing the next change.
  async save(session: SessionState, urls: [string, string][]): Promise<void> {
    await this.storage.local.set({ [URLS_KEY]: urls });
    await this.storage.session.set({ [SESSION_KEY]: session });
  }
}
