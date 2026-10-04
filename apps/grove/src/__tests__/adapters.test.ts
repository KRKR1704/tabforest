import { describe, it, expect } from 'vitest';
import { getGrove, growGrove, streamGrowGrove } from '../adapters/grove';
import {
  getMe,
  getSessions,
  getTimeline,
} from '../adapters/platform';
import { mockSnapshot } from '../mocks/mockData';
import { StreamMessage } from '../types';

describe('Adapters Suite (C3–C7)', () => {
  it('fetches grove using getGrove', async () => {
    const grove = await getGrove();
    expect(grove.trees.length).toBeGreaterThan(0);
    expect(grove.schema_version).toBe('1.0');
  });

  it('grows grove using growGrove', async () => {
    const grove = await growGrove(mockSnapshot);
    expect(grove.trees.length).toBeGreaterThan(0);
  });

  it('streams grove simulation in order: clusters -> tree -> done', async () => {
    const messages: StreamMessage[] = [];
    let isDone = false;

    await streamGrowGrove(
      mockSnapshot,
      (msg) => messages.push(msg),
      () => {
        isDone = true;
      }
    );

    expect(messages.length).toBeGreaterThanOrEqual(3);
    expect(messages[0].type).toBe('clusters');
    expect(messages[1].type).toBe('tree');
    expect(messages[messages.length - 1].type).toBe('done');
    expect(isDone).toBe(true);
  });

  it('queries platform endpoints', async () => {
    const me = await getMe();
    expect(me.email).toBe('maya@tabforest.local');

    const sessions = await getSessions();
    expect(sessions.length).toBeGreaterThan(0);

    const timeline = await getTimeline('p_10000000-0000-4000-8000-000000000001', '24h');
    expect(timeline.status).toBe('ok');

  });
});
