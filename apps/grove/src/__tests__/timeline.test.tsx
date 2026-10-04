import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import timelineContract from '@contracts/timeline.example.json';
import { App } from '../App';
import { getTimeline } from '../adapters/platform';
import { TimelineChart } from '../components/TimelineChart';
import {
  activeSpan,
  bucketMs,
  formatClock,
  minutesLabel,
  storyBeats,
} from '../lib/timeline';
import { Timeline } from '../screens/Timeline';
import { mockGroveResponse, mockTimelineResponse } from '../mocks/mockData';
import { useGroveStore } from '../store/useGroveStore';
import type { TimelineResponse } from '../types';

const timeline = mockTimelineResponse;
const [auth, prep] = mockGroveResponse.trees;
const pointCount = timeline.lanes.reduce((total, lane) => total + lane.points.length, 0);

describe('timeline helpers', () => {
  it('reads the bucket width', () => {
    expect(bucketMs('30m')).toBe(30 * 60_000);
    expect(bucketMs('1h')).toBe(60 * 60_000);
    expect(bucketMs('nonsense')).toBe(30 * 60_000);
  });

  it('writes durations as minutes', () => {
    expect(minutesLabel(570_000)).toBe('10 min');
    expect(minutesLabel(20_000)).toBe('<1 min');
    expect(minutesLabel(0)).toBe('0 min');
  });

  it('formats clock times in the zone it is given', () => {
    expect(formatClock('2026-10-04T09:30:00Z', 'UTC')).toBe('9:30 AM');
    expect(formatClock('2026-10-04T09:30:00Z', 'America/New_York')).toBe('5:30 AM');
  });

  it('spans only the part of the day with activity, on bucket edges', () => {
    const span = activeSpan(timeline);
    expect(new Date(span!.start).toISOString()).toBe('2026-10-04T09:30:00.000Z');
    expect(new Date(span!.end).toISOString()).toBe('2026-10-04T12:00:00.000Z');
    expect(activeSpan({ ...timeline, lanes: [], markers: [] })).toBeNull();
  });

  it('tells the story in order: paths picked up, the decision, then the question', () => {
    const beats = storyBeats(timeline);
    expect(beats.map((beat) => `${formatClock(beat.t, 'UTC')} ${beat.kind} ${beat.text}`)).toEqual([
      '9:30 AM path JWT',
      '9:30 AM path Sessions',
      '10:00 AM path OAuth 2.0',
      '10:12 AM decision Not using OAuth providers for v1',
      '10:58 AM question Where should refresh tokens be stored securely?',
    ]);
  });
});

describe('timeline adapter (C7)', () => {
  it('serves the contract example for its project and an empty day for any other', async () => {
    const known = await getTimeline(timeline.project_id);
    expect(known).toEqual({ status: 'ok', timeline });

    const other = await getTimeline(prep.cluster_ref);
    expect(other.status).toBe('ok');
    if (other.status === 'ok') {
      expect(other.timeline.lanes).toEqual([]);
      expect(other.timeline.project_id).toBe(prep.cluster_ref);
    }
  });

  describe('live', () => {
    const fetchMock = vi.fn();
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

    it('sends the contract request with the bearer token', async () => {
      const contract = timelineContract.examples[0];
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => contract.response.body,
      });

      const result = await getTimeline(timeline.project_id);

      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url).endsWith(contract.request.path)).toBe(true);
      expect(init.method).toBe('GET');
      expect(init.headers.Authorization).toMatch(/^Bearer /);
      expect(init.body).toBeUndefined();
      expect(result).toEqual({ status: 'ok', timeline: contract.response.body });
    });

    it('reports "reconnecting" on 503 and honours Retry-After', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers({ 'Retry-After': '7' }),
      });
      expect(await getTimeline('p')).toEqual({ status: 'reconnecting', retryAfterMs: 7000 });

      fetchMock.mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers() });
      expect(await getTimeline('p')).toEqual({ status: 'reconnecting', retryAfterMs: 5000 });
    });

    it('reports "not-found" on 404', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 404, headers: new Headers() });
      expect(await getTimeline('p_unknown')).toEqual({ status: 'not-found' });
    });

    it('falls back to the stand-in when the API cannot be reached', async () => {
      fetchMock.mockRejectedValueOnce(new Error('offline'));
      expect(await getTimeline(timeline.project_id)).toEqual({ status: 'ok', timeline });
    });
  });
});

describe('TimelineChart', () => {
  it('draws a lane per branch, with its total and status in words', () => {
    const { container } = render(<TimelineChart timeline={timeline} timeZone="UTC" />);
    const lanes = container.querySelectorAll('[data-kind="lane"]');
    expect(lanes).toHaveLength(3);
    expect(lanes[0].textContent).toContain('JWT');
    expect(lanes[0].textContent).toContain('33 min · active');
    expect(lanes[1].textContent).toContain('OAuth 2.0');
    expect(lanes[1].textContent).toContain('4 min · explored');
    expect(lanes[2].textContent).toContain('Sessions');
  });

  it('draws one bar per bucket of attention, labelled with its minutes', () => {
    const { container } = render(<TimelineChart timeline={timeline} timeZone="UTC" />);
    const bars = container.querySelectorAll('[data-kind="bar"]');
    expect(bars).toHaveLength(pointCount);
    expect(bars[0].textContent).toContain('10m');
    expect(screen.getByRole('button', { name: 'JWT, 9:30 AM: 10 min on 1 tab' })).toBeInTheDocument();
  });

  it('makes a longer stretch of attention a taller bar', () => {
    const { container } = render(<TimelineChart timeline={timeline} timeZone="UTC" />);
    const heights = Array.from(container.querySelectorAll('[data-kind="bar"] rect')).map((rect) =>
      Number(rect.getAttribute('height'))
    );
    const durations = timeline.lanes.flatMap((lane) => lane.points.map((p) => p.active_ms));
    const tallest = heights.indexOf(Math.max(...heights));
    expect(durations[tallest]).toBe(Math.max(...durations));
  });

  it('labels the time axis from the first bucket to the end of the last', () => {
    const { container } = render(<TimelineChart timeline={timeline} timeZone="UTC" />);
    const ticks = Array.from(container.querySelectorAll('[data-kind="tick"] text')).map(
      (node) => node.textContent
    );
    expect(ticks).toEqual(['9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM', '12:00 PM']);
  });

  it('marks when the question first appeared and when the decision was made', () => {
    const { container } = render(<TimelineChart timeline={timeline} timeZone="UTC" />);
    const markers = container.querySelectorAll('[data-kind="marker"]');
    expect(markers).toHaveLength(2);
    const title = (kind: string) =>
      container.querySelector(`[data-marker-kind="${kind}"] title`)?.textContent;
    expect(title('decision')).toBe('Decision made at 10:12 AM: Not using OAuth providers for v1');
    expect(title('question')).toBe(
      'Question first appeared at 10:58 AM: Where should refresh tokens be stored securely?'
    );
    // The two kinds differ by glyph and by dash pattern, not only by color.
    const dash = (kind: string) =>
      container.querySelector(`[data-marker-kind="${kind}"] line`)?.getAttribute('stroke-dasharray');
    expect(dash('decision')).not.toBe(dash('question'));
  });

  it('shows the tabs and minutes of a bar on hover, and clears them on leave', () => {
    const { container } = render(<TimelineChart timeline={timeline} timeZone="UTC" />);
    const detail = within(screen.getByRole('status'));
    expect(detail.getByText(/Hover or focus a bar/)).toBeInTheDocument();

    const busiest = container.querySelectorAll('[data-kind="bar"]')[3];
    fireEvent.mouseEnter(busiest);
    const point = timeline.lanes[0].points[3];
    expect(screen.getByRole('status')).toHaveTextContent('JWT · 11:00 AM to 11:30 AM · 12 min');
    for (const tab of point.tabs) {
      expect(detail.getByText(tab.title, { exact: false })).toBeInTheDocument();
    }
    expect(detail.getAllByRole('listitem')).toHaveLength(point.tabs.length);

    fireEvent.mouseLeave(busiest);
    expect(detail.getByText(/Hover or focus a bar/)).toBeInTheDocument();
  });

  it('shows the same detail on keyboard focus', () => {
    render(<TimelineChart timeline={timeline} timeZone="UTC" />);
    const bar = screen.getByRole('button', { name: /^Sessions, 9:30 AM/ });
    fireEvent.focus(bar);
    expect(screen.getByRole('status')).toHaveTextContent('Sessions · 9:30 AM to 10:00 AM · 6 min');
    fireEvent.blur(bar);
    expect(screen.getByRole('status')).toHaveTextContent(/Hover or focus a bar/);
  });

  it('shows tab switches per bucket', () => {
    const { container } = render(<TimelineChart timeline={timeline} timeZone="UTC" />);
    const row = container.querySelector('[data-kind="switches"]');
    expect(row?.textContent).toContain('Tab switches');
    expect(row?.querySelectorAll('title')).toHaveLength(timeline.switches.length);
  });

  it('names a lane with no branch, and renders titles as text', () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const odd: TimelineResponse = {
      ...timeline,
      lanes: [
        {
          branch: null,
          status: 'explored',
          active_ms: 60_000,
          points: [
            {
              t: '2026-10-04T10:00:00Z',
              active_ms: 60_000,
              tabs: [{ tab_ref: 'x', domain: 'example.com', title: hostile, active_ms: 60_000 }],
            },
          ],
        },
      ],
      markers: [],
      switches: [],
    };
    const { container } = render(<TimelineChart timeline={odd} timeZone="UTC" />);
    expect(container.querySelector('[data-kind="lane"]')?.textContent).toContain('Other tabs');
    fireEvent.mouseEnter(container.querySelector('[data-kind="bar"]')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(hostile, { exact: false })).toBeInTheDocument();
  });

  it('draws nothing for a day with no activity', () => {
    const { container } = render(
      <TimelineChart timeline={{ ...timeline, lanes: [], markers: [] }} timeZone="UTC" />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Timeline screen', () => {
  it('shows the story for the first goal: totals, chart and beats', async () => {
    render(<Timeline grove={mockGroveResponse} timeZone="UTC" />);
    expect(screen.getByText('Reading your timeline…')).toBeInTheDocument();

    expect(await screen.findByRole('img', { name: /Timeline of Backend Authentication/ })).toBeInTheDocument();
    expect(screen.getByText('43 min').parentElement).toHaveTextContent(
      '43 min of attention in the last 24 hours · 28 tab switches · 1 to another goal'
    );

    const beats = screen.getAllByRole('listitem').filter((item) => item.hasAttribute('data-beat'));
    expect(beats.map((beat) => beat.getAttribute('data-beat'))).toEqual([
      'path',
      'path',
      'path',
      'decision',
      'question',
    ]);
    expect(beats[3]).toHaveTextContent('10:12 AM');
    expect(beats[3]).toHaveTextContent('Decision made: Not using OAuth providers for v1');
    expect(beats[4]).toHaveTextContent('Question first appeared: Where should refresh tokens');
  });

  it('offers every goal and says so when one has nothing recorded', async () => {
    render(<Timeline grove={mockGroveResponse} timeZone="UTC" />);
    const picker = within(screen.getByRole('group', { name: 'Goal' }));
    expect(picker.getAllByRole('button').map((button) => button.textContent)).toEqual(
      mockGroveResponse.trees.map((tree) => tree.project.name)
    );
    expect(picker.getByRole('button', { name: auth.project.name })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(picker.getByRole('button', { name: prep.project.name }));
    expect(await screen.findByText('Nothing recorded in the last 24 hours.')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Timeline of/ })).not.toBeInTheDocument();
  });

  it('asks for a grove when there is none, and skips trees still listening', () => {
    const { rerender } = render(<Timeline grove={null} />);
    expect(screen.getByText('No timeline yet.')).toBeInTheDocument();

    rerender(
      <Timeline grove={{ ...mockGroveResponse, trees: [{ ...auth, pending: true }] }} />
    );
    expect(screen.getByText('No timeline yet.')).toBeInTheDocument();
  });

  describe('when memory is down', () => {
    const fetchMock = vi.fn();
    beforeEach(() => {
      vi.useFakeTimers();
      vi.stubEnv('VITE_MOCK', '0');
      vi.stubGlobal('fetch', fetchMock);
      fetchMock.mockReset();
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    const unavailable = { ok: false, status: 503, headers: new Headers({ 'Retry-After': '2' }) };
    const available = { ok: true, status: 200, json: async () => timeline };
    const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

    it('says "memory is reconnecting", retries on its own, then shows the timeline', async () => {
      fetchMock.mockResolvedValueOnce(unavailable).mockResolvedValueOnce(unavailable).mockResolvedValue(available);

      render(<Timeline grove={mockGroveResponse} timeZone="UTC" />);
      await flush();
      expect(screen.getByRole('alert')).toHaveTextContent('Memory is reconnecting…');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Not before the server said to ask again.
      await act(async () => { await vi.advanceTimersByTimeAsync(1900); });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('alert')).toHaveTextContent('Memory is reconnecting…');

      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('img', { name: /Timeline of Backend Authentication/ })).toBeInTheDocument();
    });

    it('retries at once from "Try again now"', async () => {
      fetchMock.mockResolvedValueOnce(unavailable).mockResolvedValue(available);
      render(<Timeline grove={mockGroveResponse} timeZone="UTC" />);
      await flush();

      fireEvent.click(screen.getByRole('button', { name: 'Try again now' }));
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('img', { name: /Timeline of Backend Authentication/ })).toBeInTheDocument();
    });

    it('says a goal has no timeline yet on 404', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 404, headers: new Headers() });
      render(<Timeline grove={mockGroveResponse} timeZone="UTC" />);
      await flush();
      expect(screen.getByText('No timeline for this goal yet.')).toBeInTheDocument();
    });
  });
});

describe('Timeline in the app', () => {
  beforeEach(() => {
    useGroveStore.setState({ grove: mockGroveResponse, activeScreen: 'grove', isStreaming: false });
  });

  it('opens from the left rail and draws the lanes', async () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Timeline' })).toBeInTheDocument();
    await waitFor(() => expect(container.querySelectorAll('[data-kind="lane"]')).toHaveLength(3));
    expect(container.querySelectorAll('[data-kind="marker"]')).toHaveLength(2);
  });
});
