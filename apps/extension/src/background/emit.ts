type BaseEvent = { event_id: string; ts: string; tab_ref: string };
type PageFields = { domain: string; title: string | null; dup_key: string; search_query: string | null };

export type CaptureEvent = BaseEvent & (
  | ({ type: 'OPEN'; opener_tab_ref: string | null } & PageFields)
  | ({ type: 'UPDATE' } & PageFields)
  | { type: 'FOCUS'; previous_tab_ref: string | null }
  | { type: 'BLUR'; active_ms: number }
  | { type: 'CLOSE' | 'IDLE' | 'ACTIVE' }
);

export function emit(event: CaptureEvent): void {
  // TODO(D-4): the Hollow wraps emit() before anything is queued
  console.log('[tf-capture]', event);
}
