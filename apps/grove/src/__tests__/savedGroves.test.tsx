import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import contextContract from '@contracts/saved-context.example.json';
import { App } from '../App';
import { sendBridgeMessage } from '../adapters/bridge';
import {
  listContexts,
  resetContextStandIn,
  resumeContext,
  saveContext,
  stripUrl,
  type ContextTab,
  type ResumeResult,
  type SaveContextBody,
  type SavedContextRow,
} from '../adapters/contexts';
import { ResumeCard } from '../components/ResumeCard';
import {
  buildContextCard,
  buildContextTabs,
  excludedReason,
  formatDuration,
  formatWhen,
  restorePayload,
} from '../lib/contextCard';
import { SavedGroves } from '../screens/SavedGroves';
import { mockGroveResponse } from '../mocks/mockData';
import { useGroveStore } from '../store/useGroveStore';
import { useResumeStore } from '../store/useResumeStore';

// The real bridge, wrapped so tests can see which messages were sent.
vi.mock('../adapters/bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../adapters/bridge')>();
  return { ...actual, sendBridgeMessage: vi.fn(actual.sendBridgeMessage) };
});
const bridge = vi.mocked(sendBridgeMessage);
const sent = (type: string) => bridge.mock.calls.filter(([t]) => t === type).map(([, payload]) => payload);

const example = (name: string) => contextContract.examples.find((e) => e.name === name)!;
const saveExample = example('save_resume');
const saveBody = saveExample.request.body as unknown as SaveContextBody;
const rows = (example('list_contexts').response.body as unknown as { contexts: SavedContextRow[] }).contexts;
const resumed = example('resume_next_morning').response.body as unknown as ResumeResult;

const [auth, , jobs] = mockGroveResponse.trees;
const contractUrls = Object.fromEntries(
  saveBody.tabs.map((tab) => [tab.tab_ref, tab.fallback_url ?? ''])
);
const NOW = new Date('2026-10-05T09:05:00Z');

beforeEach(() => {
  resetContextStandIn();
  bridge.mockClear();
  useResumeStore.setState({ resume: null });
  useGroveStore.setState({ grove: mockGroveResponse, activeScreen: 'grove', isStreaming: false });
});

describe('what is saved with a context', () => {
  it('builds the card from the tree exactly as the contract shows it', () => {
    expect(buildContextCard(auth)).toEqual(saveBody.card);
  });

  it('builds the tabs exactly as the contract shows them, from the bridge URLs', () => {
    expect(buildContextTabs(auth, contractUrls)).toEqual(saveBody.tabs);
  });

  it('never marks a duplicate or stale tab important, and says why it is left out', () => {
    const tabs = buildContextTabs(auth, contractUrls);
    const reasons = tabs.filter((tab) => tab.excluded_reason).map((tab) => tab.excluded_reason);
    expect(reasons.sort()).toEqual(['exact_duplicate', 'semantic_redundant', 'semantic_redundant']);
    expect(tabs.some((tab) => tab.important && tab.excluded_reason)).toBe(false);
    expect(tabs.filter((tab) => tab.important)).toHaveLength(4);

    const stale = jobs.tabs.find((tab) => tab.fallen)!;
    expect(excludedReason(jobs, stale.tab_ref)).toBe('stale');
  });

  it('leaves the URL out for a tab the device no longer knows', () => {
    const [first] = buildContextTabs(auth, {});
    expect(first).not.toHaveProperty('fallback_url');
  });

  it('has no direction for a tree without one, and no action when none is suggested', () => {
    const card = buildContextCard({
      ...auth,
      current_direction: { ...auth.current_direction, text: '' },
      next_actions: [],
    });
    expect(card.direction).toBeNull();
    expect(card.next_action).toBeNull();
  });
});

describe('formatting', () => {
  it('writes time invested as hours and minutes', () => {
    expect(formatDuration(8_040_000)).toBe('2 h 14 m');
    expect(formatDuration(6_000_000)).toBe('1 h 40 m');
    expect(formatDuration(7_200_000)).toBe('2 h');
    expect(formatDuration(540_000)).toBe('9 m');
    expect(formatDuration(20_000)).toBe('<1 m');
    expect(formatDuration(0)).toBe('0 m');
  });

  it('writes "last active" relative to today', () => {
    expect(formatWhen('2026-10-05T08:00:00Z', NOW, 'UTC')).toBe('Today, 8:00 AM');
    expect(formatWhen('2026-10-04T11:31:50Z', NOW, 'UTC')).toBe('Yesterday, 11:31 AM');
    expect(formatWhen('2026-03-12T21:35:00Z', NOW, 'UTC')).toBe('Mar 12, 9:35 PM');
    expect(formatWhen('2025-12-31T10:00:00Z', NOW, 'UTC')).toBe('Dec 31, 2025, 10:00 AM');
    expect(formatWhen('not a date', NOW, 'UTC')).toBe('');
  });
});

describe('restore payload', () => {
  it('reopens only the important tabs by default, with their fallback URLs in step', () => {
    const payload = restorePayload(resumed, 'important');
    expect(payload.tab_refs).toEqual(resumed.important_tabs.map((tab) => tab.tab_ref));
    expect(payload.fallback_urls).toEqual(resumed.important_tabs.map((tab) => tab.fallback_url));
    expect(payload.group_name).toBe('Backend Authentication');
    expect(payload.tab_refs).toHaveLength(4);
  });

  it('reopens every saved tab for "all", important ones first', () => {
    const payload = restorePayload(resumed, 'all');
    expect(payload.tab_refs).toHaveLength(10);
    expect(payload.tab_refs.slice(0, 4)).toEqual(resumed.important_tabs.map((tab) => tab.tab_ref));
    expect(payload.fallback_urls).toHaveLength(payload.tab_refs.length);
  });
});

describe('contexts adapter (C7)', () => {
  it('strips query strings and fragments before anything is sent', () => {
    expect(stripUrl('https://www.google.com/search?q=secret#top')).toBe('https://www.google.com/search');
    expect(stripUrl('https://example.com/page')).toBe('https://example.com/page');
  });

  it('stand-in: a saved context is listed first and can be resumed', async () => {
    const receipt = await saveContext(auth.cluster_ref, saveBody);
    expect(receipt).toMatchObject({ kind: 'resume', important_tab_count: 4, total_tab_count: 10 });

    const list = await listContexts();
    expect(list.sample).toBe(false);
    expect(list.contexts[0].id).toBe(receipt.id);
    expect(list.contexts).toHaveLength(rows.length + 1);

    const resume = await resumeContext(receipt.id);
    expect(resume?.card).toEqual(saveBody.card);
    expect(resume?.important_tabs).toHaveLength(4);
    expect(resume?.other_tabs).toHaveLength(6);
  });

  it('stand-in: serves the contract rows and resume, and nothing for an unknown id', async () => {
    expect((await listContexts()).contexts).toEqual(rows);
    expect(await resumeContext(resumed.id)).toEqual(resumed);
    expect(await resumeContext('s_unknown')).toBeNull();
  });

  describe('live', () => {
    const fetchMock = vi.fn();
    const reply = (body: unknown, status = 200) =>
      fetchMock.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body });
    beforeEach(() => {
      vi.stubEnv('VITE_MOCK', '0');
      vi.stubGlobal('fetch', fetchMock);
      fetchMock.mockReset();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('sends the contract save request', async () => {
      reply(saveExample.response.body, 201);
      const receipt = await saveContext(auth.cluster_ref, {
        kind: 'resume',
        title: auth.project.name,
        card: buildContextCard(auth),
        tabs: buildContextTabs(auth, contractUrls),
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url).endsWith(saveExample.request.path)).toBe(true);
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toMatch(/^Bearer /);
      expect(JSON.parse(init.body)).toEqual(saveExample.request.body);
      expect(init.body).not.toContain('user_id');
      expect(receipt).toEqual(saveExample.response.body);
    });

    it('never lets a query string reach the server', async () => {
      reply(saveExample.response.body, 201);
      const leaky: ContextTab = { ...saveBody.tabs[0], fallback_url: 'https://x.test/a?token=abc#frag' };
      await saveContext(auth.cluster_ref, { ...saveBody, tabs: [leaky] });
      const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(sentBody.tabs[0].fallback_url).toBe('https://x.test/a');
    });

    it('throws when the save fails, instead of pretending it was stored', async () => {
      reply({}, 503);
      await expect(saveContext(auth.cluster_ref, saveBody)).rejects.toThrow('HTTP 503');
    });

    it('lists with GET /api/contexts, and marks sample rows when it cannot', async () => {
      reply(example('list_contexts').response.body);
      const list = await listContexts();
      expect(String(fetchMock.mock.calls[0][0]).endsWith('/api/contexts')).toBe(true);
      expect(fetchMock.mock.calls[0][1].method).toBe('GET');
      expect(list).toEqual({ contexts: rows, sample: false });

      fetchMock.mockRejectedValueOnce(new Error('offline'));
      expect((await listContexts()).sample).toBe(true);
    });

    it('resumes with an empty POST', async () => {
      const contract = example('resume_next_morning');
      reply(contract.response.body);
      const result = await resumeContext(resumed.id);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url).endsWith(contract.request.path)).toBe(true);
      expect(init.method).toBe('POST');
      expect(init.body).toBeUndefined();
      expect(result).toEqual(resumed);
    });

    it('returns nothing when a context cannot be resumed', async () => {
      reply({}, 404);
      expect(await resumeContext('s_e0000000-0000-4000-8000-000000000404')).toBeNull();
    });
  });
});

describe('Saved Groves screen', () => {
  it('shows a card per context with last active, time invested and open questions', async () => {
    render(<SavedGroves onResume={async () => true} now={NOW} timeZone="UTC" />);
    expect(screen.getByText('Reading your saved groves…')).toBeInTheDocument();

    const cards = await screen.findAllByRole('listitem');
    expect(cards).toHaveLength(3);

    const resume = within(cards[1]);
    expect(resume.getByRole('heading', { name: 'Backend Authentication' })).toBeInTheDocument();
    expect(resume.getByText(/Resume point · saved Yesterday, 11:42 AM/)).toBeInTheDocument();
    expect(resume.getByText('Choose an authentication architecture for the application')).toBeInTheDocument();
    expect(resume.getByText('Yesterday, 11:31 AM')).toBeInTheDocument();
    expect(resume.getByText('2 h 14 m · 3 sessions')).toBeInTheDocument();
    expect(resume.getByText('4 important of 10')).toBeInTheDocument();
    expect(resume.getByText(/Prototype a refresh-token flow/)).toBeInTheDocument();
    expect(resume.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('labels references and older totals in words', async () => {
    render(<SavedGroves onResume={async () => true} now={NOW} timeZone="UTC" />);
    const cards = await screen.findAllByRole('listitem');

    const references = within(cards[0]);
    expect(references.getByText(/^References · saved/)).toBeInTheDocument();
    expect(references.getByText('2 tabs')).toBeInTheDocument();
    expect(references.getByRole('button', { name: 'Open' })).toBeInTheDocument();

    const march = within(cards[2]);
    expect(march.getByText('1 h 40 m · 2 sessions')).toBeInTheDocument();
    expect(march.getByText('None')).toBeInTheDocument();
    expect(march.getByText('Time as recorded Mar 12, 9:40 PM.')).toBeInTheDocument();
  });

  it('asks to resume the clicked context, and says so when it cannot be opened', async () => {
    const onResume = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    render(<SavedGroves onResume={onResume} now={NOW} timeZone="UTC" />);
    const cards = await screen.findAllByRole('listitem');

    fireEvent.click(within(cards[1]).getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(onResume).toHaveBeenCalledWith(rows[1].id));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.click(within(cards[2]).getByRole('button', { name: 'Resume' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That context could not be opened.');
  });
});

describe('ResumeCard', () => {
  const renderCard = (resume: ResumeResult = resumed, onRestore = vi.fn(), onDismiss = vi.fn()) => {
    render(<ResumeCard resume={resume} onRestore={onRestore} onDismiss={onDismiss} now={NOW} timeZone="UTC" />);
    return { card: within(screen.getByRole('region', { name: 'Resume' })), onRestore, onDismiss };
  };

  it('says where the user left off', () => {
    const { card } = renderCard();
    expect(card.getByRole('heading', { name: 'Backend Authentication' })).toBeInTheDocument();
    expect(
      card.getByText('Last active Yesterday, 11:31 AM · 2 h 14 m across 3 sessions')
    ).toBeInTheDocument();
    expect(card.getByText(resumed.card!.goal.display_text)).toBeInTheDocument();
    expect(card.getByText('OAuth 2.0 · Sessions')).toBeInTheDocument();
    expect(card.getByText('JWT appears to be the preferred approach')).toBeInTheDocument();
    expect(card.getByText('Not using OAuth providers for v1')).toBeInTheDocument();
    expect(card.getByText(/Likely still open: where should refresh tokens/)).toBeInTheDocument();
    expect(card.getByText(/Likely next: prototype a refresh-token flow/)).toBeInTheDocument();
    // Certainty is carried over: the stated decision and the inferred claims keep their labels.
    expect(card.getAllByText('Stated')).toHaveLength(1);
    expect(card.getAllByText('Inferred').length).toBeGreaterThanOrEqual(3);
  });

  it('offers to restore the important tabs, all tabs, or nothing', () => {
    const { card, onRestore } = renderCard();
    fireEvent.click(card.getByRole('button', { name: 'Restore 4 important tabs' }));
    expect(onRestore).toHaveBeenLastCalledWith('important');
    fireEvent.click(card.getByRole('button', { name: 'Restore all 10' }));
    expect(onRestore).toHaveBeenLastCalledWith('all');

    fireEvent.click(card.getByRole('button', { name: 'Just read summary' }));
    expect(onRestore).toHaveBeenCalledTimes(2);
    expect(card.getByText('Reading only. No tabs were reopened.')).toBeInTheDocument();
    expect(card.queryByRole('button', { name: /^Restore/ })).not.toBeInTheDocument();

    fireEvent.click(card.getByRole('button', { name: 'Show restore options' }));
    expect(card.getByRole('button', { name: 'Restore 4 important tabs' })).toBeInTheDocument();
  });

  it('offers only the options the server allows', () => {
    const { card } = renderCard({ ...resumed, restore_options: ['summary'] });
    expect(card.queryByRole('button', { name: /^Restore/ })).not.toBeInTheDocument();
    expect(card.getByRole('button', { name: 'Just read summary' })).toBeInTheDocument();
  });

  it('describes saved references, which have no card', () => {
    const { card } = renderCard({
      ...resumed,
      kind: 'references',
      card: null,
      important_tabs: [],
      other_tabs: resumed.other_tabs.slice(0, 2),
    });
    expect(card.getByText(/2 saved references/)).toBeInTheDocument();
    expect(card.queryByRole('button', { name: /important/ })).not.toBeInTheDocument();
    expect(card.getByRole('button', { name: 'Restore all 2' })).toBeInTheDocument();
  });

  it('can be dismissed, and renders saved text as text', () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const { card, onDismiss } = renderCard({
      ...resumed,
      title: hostile,
      card: { ...resumed.card!, goal: { ...resumed.card!.goal, display_text: hostile } },
    });
    expect(document.querySelector('img')).toBeNull();
    expect(card.getAllByText(hostile)).toHaveLength(2);
    fireEvent.click(card.getByRole('button', { name: 'Dismiss resume card' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('save and resume in the app', () => {
  // Scoped to the screen: the left rail has list items of its own.
  const contextCards = () => within(screen.getByRole('main')).findAllByRole('listitem');

  it('saves from Tree Detail: asks the bridge for URLs first, then stores the context', async () => {
    const { container } = render(<App />);
    fireEvent.click(container.querySelector('[data-kind="trunk"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Save context' }));

    expect(
      await screen.findByText('Saved. 4 of 10 tabs are marked to reopen. Find it under Saved Groves.')
    ).toBeInTheDocument();
    expect(sent('GET_URLS')).toEqual([{ tab_refs: auth.tabs.map((tab) => tab.tab_ref) }]);

    fireEvent.click(screen.getByRole('button', { name: 'Saved Groves' }));
    const cards = await contextCards();
    expect(cards).toHaveLength(rows.length + 1);
    expect(within(cards[0]).getByRole('heading', { name: auth.project.name })).toBeInTheDocument();
    expect(within(cards[0]).getByText('4 important of 10')).toBeInTheDocument();
  });

  it('resumes from Saved Groves: the card is pinned above the grove', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Saved Groves' }));
    const cards = await contextCards();
    fireEvent.click(within(cards[1]).getByRole('button', { name: 'Resume' }));

    const card = await screen.findByRole('region', { name: 'Resume' });
    expect(screen.getByRole('heading', { level: 1, name: 'Current Grove' })).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: 'Backend Authentication' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Living Grove/ })).toBeInTheDocument();
    expect(sent('RESTORE')).toEqual([]);
  });

  const openResume = async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Saved Groves' }));
    const cards = await contextCards();
    fireEvent.click(within(cards[1]).getByRole('button', { name: 'Resume' }));
    return within(await screen.findByRole('region', { name: 'Resume' }));
  };

  it('Restore important sends exactly the important refs, with fallback URLs', async () => {
    const card = await openResume();
    fireEvent.click(card.getByRole('button', { name: 'Restore 4 important tabs' }));

    expect(await card.findByText('Reopened 4 tabs.')).toBeInTheDocument();
    expect(sent('RESTORE')).toEqual([
      {
        tab_refs: resumed.important_tabs.map((tab) => tab.tab_ref),
        group_name: 'Backend Authentication',
        fallback_urls: resumed.important_tabs.map((tab) => tab.fallback_url),
      },
    ]);
  });

  it('Restore all sends every saved ref', async () => {
    const card = await openResume();
    fireEvent.click(card.getByRole('button', { name: 'Restore all 10' }));

    expect(await card.findByText('Reopened 10 tabs.')).toBeInTheDocument();
    const [payload] = sent('RESTORE') as Array<{ tab_refs: string[]; fallback_urls: string[] }>;
    expect(payload.tab_refs).toEqual(
      [...resumed.important_tabs, ...resumed.other_tabs].map((tab) => tab.tab_ref)
    );
    expect(payload.fallback_urls).toHaveLength(10);
  });

  it('Just read summary reopens nothing, and the card can be dismissed', async () => {
    const card = await openResume();
    fireEvent.click(card.getByRole('button', { name: 'Just read summary' }));
    expect(sent('RESTORE')).toEqual([]);

    fireEvent.click(card.getByRole('button', { name: 'Dismiss resume card' }));
    expect(screen.queryByRole('region', { name: 'Resume' })).not.toBeInTheDocument();
  });

  it('shows the resume card even before a grove has grown', async () => {
    useGroveStore.setState({ grove: null });
    await openResume();
    expect(screen.getByText('No grove yet.')).toBeInTheDocument();
  });
});
