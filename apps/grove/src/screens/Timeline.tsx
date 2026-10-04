import React, { useEffect, useState } from 'react';
import { getTimeline } from '../adapters/platform';
import { TimelineChart } from '../components/TimelineChart';
import { MushroomIcon } from '../components/icons';
import { formatClock, minutesLabel, storyBeats } from '../lib/timeline';
import type { GroveResponse, TimelineResponse, TimelineResult } from '../types';

interface TimelineProps {
  grove: GroveResponse | null;
  /** IANA zone for the clock labels; the reader's own zone when left out. */
  timeZone?: string;
}

type TimelineState = { status: 'loading' } | TimelineResult;

/** Loads one project's timeline and keeps asking while the memory store reconnects. */
function useTimeline(projectId: string | null) {
  const [state, setState] = useState<TimelineState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setState({ status: 'loading' });
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void getTimeline(projectId).then((result) => {
      if (cancelled) return;
      setState(result);
      if (result.status === 'reconnecting') {
        timer = setTimeout(() => setAttempt((n) => n + 1), result.retryAfterMs);
      }
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, attempt]);

  return { state, retry: () => setAttempt((n) => n + 1) };
}

const Message: React.FC<{ title: string; children?: React.ReactNode }> = ({ title, children }) => (
  <div className="py-10">
    <p className="font-serif text-lg text-forest-100">{title}</p>
    {children && <div className="mt-2 text-sm text-forest-400">{children}</div>}
  </div>
);

const Story: React.FC<{ timeline: TimelineResponse; timeZone?: string }> = ({
  timeline,
  timeZone,
}) => {
  const beats = storyBeats(timeline);
  if (beats.length === 0) return null;
  return (
    <section className="mt-8">
      <h3 className="text-xs font-medium uppercase tracking-wider text-forest-400">
        How it unfolded
      </h3>
      <ol className="mt-3 space-y-2">
        {beats.map((beat) => (
          <li
            key={`${beat.kind}-${beat.t}-${beat.text}`}
            data-beat={beat.kind}
            className="flex items-start gap-3 text-sm"
          >
            <span className="w-20 shrink-0 text-forest-300">{formatClock(beat.t, timeZone)}</span>
            {beat.kind === 'question' && (
              <MushroomIcon className="mt-0.5 h-4 w-4 shrink-0 text-amberCanopy-light" />
            )}
            <span className="text-forest-100">
              {beat.kind === 'path' && (
                <>
                  Picked up <span className="font-medium text-forest-50">{beat.text}</span>
                </>
              )}
              {beat.kind === 'decision' && (
                <>
                  <span className="text-stoneGray-light">Decision made:</span> {beat.text}
                </>
              )}
              {beat.kind === 'question' && (
                <>
                  <span className="text-amberCanopy-light">Question first appeared:</span> {beat.text}
                </>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
};

export const Timeline: React.FC<TimelineProps> = ({ grove, timeZone }) => {
  // A tree that is still listening has no project on the server yet.
  const trees = (grove?.trees ?? []).filter((tree) => !tree.pending);
  const [chosen, setChosen] = useState<string | null>(null);
  const projectId = trees.some((tree) => tree.cluster_ref === chosen)
    ? chosen
    : trees[0]?.cluster_ref ?? null;
  const { state, retry } = useTimeline(projectId);

  if (trees.length === 0 || !projectId) {
    return (
      <div className="mx-auto max-w-4xl px-8">
        <Message title="No timeline yet.">
          Grow a grove first; each goal then gets a timeline of how its research unfolded.
        </Message>
      </div>
    );
  }

  const timeline = state.status === 'ok' ? state.timeline : null;
  const hasActivity = timeline !== null && timeline.lanes.some((lane) => lane.points.length > 0);

  return (
    <div className="mx-auto max-w-5xl px-8 py-6">
      <div role="group" aria-label="Goal" className="flex flex-wrap gap-x-5 border-b border-forest-800">
        {trees.map((tree) => (
          <button
            key={tree.cluster_ref}
            type="button"
            aria-pressed={tree.cluster_ref === projectId}
            onClick={() => setChosen(tree.cluster_ref)}
            className={`-mb-px border-b-2 py-2 text-sm ${
              tree.cluster_ref === projectId
                ? 'border-forest-400 font-medium text-forest-50'
                : 'border-transparent text-forest-300 hover:text-forest-100'
            }`}
          >
            {tree.project.name}
          </button>
        ))}
      </div>

      {state.status === 'loading' && <Message title="Reading your timeline…" />}

      {state.status === 'reconnecting' && (
        <div role="alert">
          <Message title="Memory is reconnecting…">
            <p>The timeline will appear on its own as soon as your memory store is back.</p>
            <button
              type="button"
              onClick={retry}
              className="mt-3 rounded-sm border border-forest-700 px-2 py-0.5 text-xs text-forest-200 hover:border-forest-500 hover:text-forest-50"
            >
              Try again now
            </button>
          </Message>
        </div>
      )}

      {state.status === 'not-found' && (
        <Message title="No timeline for this goal yet.">
          It will have one once its tabs have been captured for a while.
        </Message>
      )}

      {timeline && !hasActivity && (
        <Message title="Nothing recorded in the last 24 hours.">
          Time spent on this goal's tabs will show up here.
        </Message>
      )}

      {timeline && hasActivity && (
        <>
          <p className="mt-5 text-sm text-forest-200">
            <span className="font-medium text-forest-50">
              {minutesLabel(timeline.totals.active_ms)}
            </span>{' '}
            of attention in the last 24 hours · {timeline.totals.tab_switches} tab{' '}
            {timeline.totals.tab_switches === 1 ? 'switch' : 'switches'} ·{' '}
            {timeline.totals.intent_switches} to another goal
          </p>
          <div className="mt-5">
            <TimelineChart timeline={timeline} timeZone={timeZone} />
          </div>
          <Story timeline={timeline} timeZone={timeZone} />
        </>
      )}
    </div>
  );
};
