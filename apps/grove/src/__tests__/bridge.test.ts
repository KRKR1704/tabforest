import { describe, it, expect } from 'vitest';
import { sendBridgeMessage } from '../adapters/bridge';
import { SnapshotPayload, AuthStateData, SendPreviewData, WorkItemsData } from '../types';

describe('Bridge Adapter (C8)', () => {
  it('handles GET_SNAPSHOT message', async () => {
    const res = await sendBridgeMessage<void, SnapshotPayload>('GET_SNAPSHOT');
    expect(res.ok).toBe(true);
    expect(res.data?.tabs.length).toBeGreaterThan(0);
  });

  it('handles GET_TOKEN message', async () => {
    const res = await sendBridgeMessage<void, { token: string | null }>('GET_TOKEN');
    expect(res.ok).toBe(true);
    expect(res.data?.token).toBeTruthy();
  });

  it('handles GET_AUTH_STATE message', async () => {
    const res = await sendBridgeMessage<void, AuthStateData>('GET_AUTH_STATE');
    expect(res.ok).toBe(true);
    expect(res.data?.signed_in).toBe(true);
    expect(res.data?.display_name).toBe('Maya Lin');
  });

  it('handles GET_HOLLOW_COUNT message', async () => {
    const res = await sendBridgeMessage<void, { count: number }>('GET_HOLLOW_COUNT');
    expect(res.ok).toBe(true);
    expect(res.data?.count).toBe(3);
  });

  it('handles GET_SEND_PREVIEW message', async () => {
    const res = await sendBridgeMessage<void, SendPreviewData>('GET_SEND_PREVIEW');
    expect(res.ok).toBe(true);
    expect(res.data?.pending_count).toBe(5);
    expect(res.data?.sample_events.length).toBeGreaterThan(0);
  });

  it('handles GET_WORK_ITEMS and CLEAR_WORK_ITEMS', async () => {
    const res = await sendBridgeMessage<void, WorkItemsData>('GET_WORK_ITEMS');
    expect(res.ok).toBe(true);
    expect(res.data?.items.length).toBe(2);

    const clearRes = await sendBridgeMessage('CLEAR_WORK_ITEMS');
    expect(clearRes.ok).toBe(true);
  });

  it('handles EXCLUDE_DOMAIN and PAUSE', async () => {
    const pauseRes = await sendBridgeMessage('PAUSE', { until: '2026-10-04T18:00:00Z' });
    expect(pauseRes.ok).toBe(true);

    const excludeRes = await sendBridgeMessage('EXCLUDE_DOMAIN', { domain: 'newdomain.com' });
    expect(excludeRes.ok).toBe(true);
  });

  it('handles OPEN_TAB and CLOSE_TABS', async () => {
    const openRes = await sendBridgeMessage('OPEN_TAB', { tab_ref: 't1' });
    expect(openRes.ok).toBe(true);

    const closeRes = await sendBridgeMessage('CLOSE_TABS', { tab_refs: ['t1', 't2'] });
    expect(closeRes.ok).toBe(true);
  });
});
