import React, { useState } from 'react';
import type { TimelineLane, TimelinePoint, TimelineResponse } from '../types';
import { activeSpan, bucketMs, formatClock, minutes, minutesLabel } from '../lib/timeline';

interface TimelineChartProps {
  timeline: TimelineResponse;
  /** IANA zone for the clock labels; the reader's own zone when left out. */
  timeZone?: string;
}

const WIDTH = 960;
const GUTTER = 150;
const RIGHT_PAD = 36;
const AXIS_HEIGHT = 46;
const LANE_HEIGHT = 62;
const SWITCH_ROW = 34;
const BAR_ROOM = LANE_HEIGHT - 20;

const laneLabel = (lane: TimelineLane) => lane.branch ?? 'Other tabs';

/** Mushroom for a question, stone for a decision: the same marks the grove uses. */
const MarkerGlyph: React.FC<{ kind: 'question' | 'decision'; x: number; y: number }> = ({
  kind,
  x,
  y,
}) =>
  kind === 'question' ? (
    <g transform={`translate(${x},${y})`} className="text-amberCanopy-light">
      <path d="M-7,0A7,6 0 0 1 7,0Z" fill="currentColor" />
      <rect x={-1.6} y={0} width={3.2} height={6} rx={1} className="fill-bark-100" />
    </g>
  ) : (
    <path
      transform={`translate(${x},${y + 5})`}
      d="M-8,0Q-9,-7 -3,-9Q3,-11 7,-8Q10,-5 8,0Z"
      className="fill-stoneGray stroke-stoneGray-light"
      strokeWidth={1}
    />
  );

export const TimelineChart: React.FC<TimelineChartProps> = ({ timeline, timeZone }) => {
  const [hovered, setHovered] = useState<{ lane: number; point: number } | null>(null);

  const span = activeSpan(timeline);
  if (!span || timeline.lanes.length === 0) return null;

  const bucket = bucketMs(timeline.bucket);
  const plotWidth = WIDTH - GUTTER - RIGHT_PAD;
  const x = (time: number) => GUTTER + ((time - span.start) / (span.end - span.start)) * plotWidth;
  const laneTop = (index: number) => AXIS_HEIGHT + index * LANE_HEIGHT;
  const lanesBottom = laneTop(timeline.lanes.length);
  const height = lanesBottom + (timeline.switches.length > 0 ? SWITCH_ROW : 0) + 8;

  const ticks: number[] = [];
  for (let time = span.start; time <= span.end; time += bucket) ticks.push(time);

  const tallest = Math.max(
    1,
    ...timeline.lanes.flatMap((lane) => lane.points.map((point) => point.active_ms))
  );

  const active: { lane: TimelineLane; point: TimelinePoint } | null = hovered
    ? {
        lane: timeline.lanes[hovered.lane],
        point: timeline.lanes[hovered.lane]?.points[hovered.point],
      }
    : null;

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-label={`Timeline of ${timeline.name}: ${timeline.lanes.length} research paths from ${formatClock(
          span.start,
          timeZone
        )} to ${formatClock(span.end, timeZone)}`}
        className="w-full"
      >
        {ticks.map((time) => (
          <g key={time} data-kind="tick">
            <line
              x1={x(time)}
              x2={x(time)}
              y1={AXIS_HEIGHT - 6}
              y2={lanesBottom}
              className="stroke-forest-800"
              strokeWidth={1}
            />
            <text
              x={x(time)}
              y={AXIS_HEIGHT - 12}
              textAnchor="middle"
              className="fill-forest-300 font-sans"
              fontSize={12}
            >
              {formatClock(time, timeZone)}
            </text>
          </g>
        ))}

        {timeline.lanes.map((lane, laneIndex) => {
          const top = laneTop(laneIndex);
          const baseline = top + LANE_HEIGHT - 8;
          return (
            <g key={laneLabel(lane)} data-kind="lane" data-status={lane.status}>
              <line
                x1={GUTTER}
                x2={WIDTH - RIGHT_PAD}
                y1={baseline}
                y2={baseline}
                className="stroke-forest-800"
                strokeWidth={1}
              />
              <text x={0} y={top + 26} className="fill-forest-50 font-sans" fontSize={14} fontWeight={500}>
                {laneLabel(lane)}
              </text>
              <text x={0} y={top + 44} className="fill-forest-400 font-sans" fontSize={12}>
                {minutesLabel(lane.active_ms)} · {lane.status}
              </text>

              {lane.points.map((point, pointIndex) => {
                const start = Date.parse(point.t);
                const barHeight = Math.max(3, (point.active_ms / tallest) * BAR_ROOM);
                const isHovered = hovered?.lane === laneIndex && hovered.point === pointIndex;
                const show = () => setHovered({ lane: laneIndex, point: pointIndex });
                const label = `${laneLabel(lane)}, ${formatClock(start, timeZone)}: ${minutesLabel(
                  point.active_ms
                )} on ${point.tabs.length} ${point.tabs.length === 1 ? 'tab' : 'tabs'}`;
                return (
                  <g
                    key={point.t}
                    data-kind="bar"
                    tabIndex={0}
                    role="button"
                    aria-label={label}
                    onMouseEnter={show}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={show}
                    onBlur={() => setHovered(null)}
                    className="cursor-default outline-none"
                  >
                    <title>{label}</title>
                    <rect
                      x={x(start) + 3}
                      y={baseline - barHeight}
                      width={Math.max(4, x(start + bucket) - x(start) - 6)}
                      height={barHeight}
                      rx={2}
                      className={`${
                        lane.status === 'active' ? 'fill-forest-400' : 'fill-forest-600'
                      } ${isHovered ? 'stroke-forest-50' : 'stroke-transparent'}`}
                      strokeWidth={1.5}
                    />
                    <text
                      x={(x(start) + x(start + bucket)) / 2}
                      y={baseline - barHeight - 5}
                      textAnchor="middle"
                      className="fill-forest-200 font-sans"
                      fontSize={11}
                    >
                      {minutes(point.active_ms) < 1 ? '<1' : minutes(point.active_ms)}m
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}

        {timeline.switches.length > 0 && (
          <g data-kind="switches">
            <text x={0} y={lanesBottom + 22} className="fill-forest-400 font-sans" fontSize={12}>
              Tab switches
            </text>
            {timeline.switches.map((item) => {
              const start = Date.parse(item.t);
              return (
                <text
                  key={item.t}
                  x={(x(start) + x(start + bucket)) / 2}
                  y={lanesBottom + 22}
                  textAnchor="middle"
                  className="fill-forest-300 font-sans"
                  fontSize={12}
                >
                  <title>
                    {`${item.tab_switches} tab switches, ${item.intent_switches} to another goal`}
                  </title>
                  {item.tab_switches}
                </text>
              );
            })}
          </g>
        )}

        {timeline.markers.map((marker) => {
          const at = x(Date.parse(marker.t));
          const what = marker.kind === 'question' ? 'Question first appeared' : 'Decision made';
          return (
            <g key={marker.id} data-kind="marker" data-marker-kind={marker.kind}>
              <title>{`${what} at ${formatClock(marker.t, timeZone)}: ${marker.text}`}</title>
              <line
                x1={at}
                x2={at}
                y1={AXIS_HEIGHT - 4}
                y2={lanesBottom}
                className={marker.kind === 'question' ? 'stroke-amberCanopy-light' : 'stroke-stoneGray-light'}
                strokeWidth={1.5}
                strokeDasharray={marker.kind === 'question' ? '2 4' : '6 3'}
              />
              <MarkerGlyph kind={marker.kind} x={at} y={8} />
            </g>
          );
        })}
      </svg>

      <div role="status" className="mt-3 min-h-[5.5rem] border-t border-forest-800 pt-3">
        {active ? (
          <>
            <p className="text-sm text-forest-50">
              <span className="font-medium">{laneLabel(active.lane)}</span> ·{' '}
              {formatClock(active.point.t, timeZone)} to{' '}
              {formatClock(Date.parse(active.point.t) + bucket, timeZone)} ·{' '}
              {minutesLabel(active.point.active_ms)}
            </p>
            <ul className="mt-2 space-y-1">
              {active.point.tabs.map((tab) => (
                <li key={tab.tab_ref} className="flex gap-3 text-sm">
                  <span className="w-16 shrink-0 text-forest-300">{minutesLabel(tab.active_ms)}</span>
                  <span className="min-w-0 text-forest-100">
                    {tab.title} <span className="text-forest-400">· {tab.domain}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-forest-400">
            Hover or focus a bar to see its tabs and minutes.
          </p>
        )}
      </div>
    </div>
  );
};
