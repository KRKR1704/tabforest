import { describe, it, expect } from 'vitest';
import { getGrove, growGrove, streamGrowGrove } from '../adapters/grove';
import { searchMemory, getPruneSuggestions } from '../adapters/memory';
import { analyzeWorkContext } from '../adapters/workContext';
import {
  getMe,
  getSessions,
  getTimeline,
  getContexts,
  getPrivacy,
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

  it('searches memory and fetches prune suggestions', async () => {
    const hit = await searchMemory('session storage');
    expect(hit.results.length).toBeGreaterThan(0);

    const miss = await searchMemory('random obscure term');
    expect(miss.results.length).toBe(0);

    const prunes = await getPruneSuggestions();
    expect(prunes.suggestions.length).toBeGreaterThan(0);
  });

  it('analyzes work context', async () => {
    const res = await analyzeWorkContext('Cloud Migration', [
      {
        title: 'Meeting transcript',
        source_type: 'paste',
        text: 'Deploy on Azure Functions',
      },
    ]);
    expect(res.project).toBe('Cloud Migration');
    expect(res.decisions.length).toBeGreaterThan(0);
  });

  it('queries platform endpoints', async () => {
    const me = await getMe();
    expect(me.email).toBe('maya@tabforest.local');

    const sessions = await getSessions();
    expect(sessions.length).toBeGreaterThan(0);

    const timeline = await getTimeline('p_10000000-0000-4000-8000-000000000001', '24h');
    expect(timeline.status).toBe('ok');

    const contexts = await getContexts();
    expect(contexts.length).toBeGreaterThan(0);

    const privacy = await getPrivacy();
    expect(privacy.excluded_domains.length).toBeGreaterThan(0);
  });
});
