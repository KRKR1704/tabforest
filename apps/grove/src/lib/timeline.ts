// Pure helpers for the research timeline (SPEC §9.2 screen 4).
import type { TimelineResponse } from '../types';

const MINUTE = 60_000;

/** "30m" → milliseconds. The contract only uses minutes; hours are accepted too. */
export function bucketMs(bucket: string): number {
  const match = /^(\d+)\s*([mh])$/.exec(bucket.trim());
  if (!match) return 30 * MINUTE;
  return Number(match[1]) * (match[2] === 'h' ? 60 : 1) * MINUTE;
}

export function minutes(ms: number): number {
  return Math.round(ms / MINUTE);
}

export function minutesLabel(ms: number): string {
  if (ms <= 0) return '0 min';
  const value = minutes(ms);
  return value < 1 ? '<1 min' : `${value} min`;
}

/** Clock time in the reader's own time zone, unless one is given. */
export function formatClock(time: string | number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(time));
}

export interface TimeSpan {
  start: number;
  end: number;
}

/**
 * The stretch of the day that has anything in it. The API answers for 24 hours,
 * but research usually fills a couple of them; drawing all 24 would flatten it.
 */
export function activeSpan(timeline: TimelineResponse): TimeSpan | null {
  const bucket = bucketMs(timeline.bucket);
  const starts = timeline.lanes.flatMap((lane) => lane.points.map((p) => Date.parse(p.t)));
  const marks = timeline.markers.map((marker) => Date.parse(marker.t));
  const all = [...starts, ...marks].filter((value) => Number.isFinite(value));
  if (all.length === 0) return null;
  const start = Math.floor(Math.min(...all) / bucket) * bucket;
  const lastStart = Math.floor(Math.max(...all) / bucket) * bucket;
  return { start, end: lastStart + bucket };
}

export type StoryBeat =
  | { kind: 'path'; t: number; text: string }
  | { kind: 'decision' | 'question'; t: number; text: string; id: string };

/**
 * How the research unfolded, in order: when each path was first picked up,
 * when a decision was made, when a question first appeared.
 */
export function storyBeats(timeline: TimelineResponse): StoryBeat[] {
  const paths: StoryBeat[] = timeline.lanes.flatMap((lane) => {
    const first = Math.min(...lane.points.map((point) => Date.parse(point.t)));
    if (!Number.isFinite(first)) return [];
    return [{ kind: 'path' as const, t: first, text: lane.branch ?? 'Other tabs' }];
  });
  const marks: StoryBeat[] = timeline.markers.map((marker) => ({
    kind: marker.kind,
    t: Date.parse(marker.t),
    text: marker.text,
    id: marker.id,
  }));
  // Array.prototype.sort is stable, so paths that start together keep lane order.
  return [...paths, ...marks].sort((a, b) => a.t - b.t);
}
