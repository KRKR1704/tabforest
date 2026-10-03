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

export type BridgeRequest =
  | { type: 'GET_SNAPSHOT' }
  | ({ type: 'OPEN_TAB' } & OpenTabPayload)
  | ({ type: 'CLOSE_TABS' } & CloseTabsPayload)
  | ({ type: 'RESTORE' } & RestorePayload)
  | ({ type: 'GET_URLS' } & GetUrlsPayload)
  | { type: 'SIGN_IN' }
  | { type: 'SIGN_OUT' }
  | { type: 'GET_AUTH_STATE' }
  | { type: 'GET_TOKEN' }
  | ({ type: 'PAUSE' } & PausePayload)
  | ({ type: 'EXCLUDE_DOMAIN' } & ExcludeDomainPayload)
  | { type: 'GET_HOLLOW_COUNT' }
  | { type: 'GET_SEND_PREVIEW' }
  | { type: 'GET_WORK_ITEMS' }
  | { type: 'CLEAR_WORK_ITEMS' }
  | { type: 'WIPE_LOCAL' };

// Proposed: stripped URLs keyed by tab_ref; pending team review.
export interface GetUrlsData {
  urls: Record<string, string>;
}

// Proposed: acknowledgement-only messages return null data; pending team review.
export type AcknowledgementData = null;

export interface BridgeReplyMap {
  GET_SNAPSHOT: SnapshotPayload;
  OPEN_TAB: AcknowledgementData;
  CLOSE_TABS: AcknowledgementData;
  RESTORE: AcknowledgementData;
  GET_URLS: GetUrlsData;
  SIGN_IN: AcknowledgementData;
  SIGN_OUT: AcknowledgementData;
  GET_AUTH_STATE: AuthStateData;
  GET_TOKEN: TokenData;
  PAUSE: AcknowledgementData;
  EXCLUDE_DOMAIN: AcknowledgementData;
  GET_HOLLOW_COUNT: HollowCountData;
  GET_SEND_PREVIEW: SendPreviewData;
  GET_WORK_ITEMS: WorkItemsData;
  CLEAR_WORK_ITEMS: AcknowledgementData;
  WIPE_LOCAL: AcknowledgementData;
}

export type BridgeReply<T extends MessageType> = BridgeResponse<BridgeReplyMap[T]>;
