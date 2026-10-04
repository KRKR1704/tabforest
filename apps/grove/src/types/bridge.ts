export type MessageType =
  | 'GET_SNAPSHOT'
  | 'OPEN_TAB'
  | 'CLOSE_TABS'
  | 'RESTORE'
  | 'GET_URLS'
  | 'SIGN_IN'
  | 'SIGN_OUT'
  | 'GET_AUTH_STATE'
  | 'GET_TOKEN'
  | 'PAUSE'
  | 'EXCLUDE_DOMAIN'
  | 'GET_HOLLOW_COUNT'
  | 'GET_SEND_PREVIEW'
  | 'GET_WORK_ITEMS'
  | 'CLEAR_WORK_ITEMS'
  | 'WIPE_LOCAL';

export interface BridgeResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface TabSnapshotItem {
  tab_ref: string;
  domain: string;
  title: string;
  opener_tab_ref: string | null;
  opened_at: string;
  active: boolean;
  pinned: boolean;
  dup_key: string;
  search_query: string | null;
}

/** Reply to GET_SNAPSHOT and the body of grow (contracts/snapshot.example.json). */
export interface SnapshotPayload {
  open_tabs: TabSnapshotItem[];
}

export interface OpenTabPayload {
  tab_ref: string;
}

export interface CloseTabsPayload {
  tab_refs: string[];
}

export interface RestorePayload {
  tab_refs: string[];
  group_name?: string;
  fallback_urls?: string[];
}

export interface GetUrlsPayload {
  tab_refs: string[];
}

export interface PausePayload {
  until: string | null;
}

export interface ExcludeDomainPayload {
  domain: string;
}

export interface AuthStateData {
  signed_in: boolean;
  user_id?: string;
  display_name?: string;
  email?: string;
}

export interface TokenData {
  token: string | null;
}

export interface HollowCountData {
  count: number;
}

export interface SendPreviewData {
  pending_count: number;
  oldest_event_ts?: string;
  sample_events: Array<{
    event_id: string;
    event_type: string;
    domain?: string;
    ts: string;
  }>;
}

export interface WorkItem {
  id: string;
  title: string;
  url?: string;
  text: string;
  source_type: 'selection' | 'page_text' | 'paste' | 'upload';
  captured_at: string;
}

export interface WorkItemsData {
  items: WorkItem[];
}
