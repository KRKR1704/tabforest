import React, { useEffect, useRef, useState } from 'react';
import { Trees } from 'lucide-react';
import { GUIDE_KEY, GUIDE_STEPS } from '../lib/guideGrove';
import { GroveCanvas } from '../viz/GroveCanvas';

interface GroveGuideProps {
  /** Finished or skipped. */
  onDone: () => void;
}

/** How long the "before" picture is held, so the eye finds the tree before it changes. */
export const GUIDE_PAUSE_MS = 900;

const quiet =
  'rounded-md border border-forest-700 px-4 py-2 text-sm text-forest-200 hover:border-forest-500 hover:text-forest-50 disabled:opacity-40';
const primary =
  'rounded-md bg-forest-600 px-4 py-2 text-sm font-medium text-forest-50 hover:bg-forest-500';

const KeyIcon: React.FC<{ id: (typeof GUIDE_KEY)[number]['id'] }> = ({ id }) => (
  <svg viewBox="0 0 26 26" className="h-6 w-6 shrink-0" aria-hidden="true">
    {id === 'tree' && (
      <>
        <circle cx="13" cy="10" r="8" fill="#2f5539" />
        <rect x="11.5" y="14" width="3" height="10" fill="#715c4a" />
      </>
    )}
    {id === 'leaf' && <path d="M4,13C9,5 18,7 23,13C18,19 9,21 4,13Z" fill="#6ea57c" stroke="#f2f8f4" />}
    {id === 'trunk' && <path d="M8,24Q11,14 11,4L15,4Q15,14 18,24Z" fill="#715c4a" />}
    {id === 'mushroom' && (
      <>
        <rect x="11" y="13" width="4" height="10" rx="2" fill="#efeae4" />
        <path d="M3,14A10,9 0 0 1 23,14Z" fill="#f5c26b" />
      </>
    )}
    {id === 'flower' && (
      <>
        <rect x="12" y="13" width="2" height="11" fill="#4c875b" />
        <g fill="#efeae4">
          <circle cx="13" cy="5" r="3.6" />
          <circle cx="18" cy="9" r="3.6" />
          <circle cx="16" cy="14" r="3.6" />
          <circle cx="10" cy="14" r="3.6" />
          <circle cx="8" cy="9" r="3.6" />
        </g>
        <circle cx="13" cy="10" r="2.8" fill="#ffd54f" />
      </>
    )}
    {id === 'stone' && <path d="M3,21Q2,10 9,7Q17,4 22,9Q26,14 24,21Z" fill="#78909c" stroke="#cfd8dc" />}
    {id === 'amber' && (
      <>
        <circle cx="13" cy="10" r="8" fill="#a85b13" />
        <rect x="11.5" y="14" width="3" height="10" fill="#715c4a" />
      </>
    )}
  </svg>
);

/**
 * "How to read your grove": a walk through what each thing in the grove means,
 * one change at a time, on a small example grove drawn by the real canvas.
 */
export const GroveGuide: React.FC<GroveGuideProps> = ({ onDone }) => {
  const [index, setIndex] = useState(0);
  const [run, setRun] = useState(0);
  const [changed, setChanged] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const step = GUIDE_STEPS[index];
  const last = index === GUIDE_STEPS.length - 1;

  // Each step shows the grove as it was, waits a moment, then makes the change.
  useEffect(() => {
    setChanged(false);
    const timer = setTimeout(() => setChanged(true), GUIDE_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [index, run]);

  useEffect(() => {
    heading.current?.focus();
  }, [index]);

  // The trees this step is not about step back, so it is clear where to look.
  useEffect(() => {
    const root = stage.current;
    if (!root) return;
    root.querySelectorAll('[data-kind="tree"]').forEach((node) => {
      const away = !step.focus.includes(node.getAttribute('data-tree-id') ?? '');
      if (away) node.setAttribute('data-guide-away', 'true');
      else node.removeAttribute('data-guide-away');
    });
    root.querySelectorAll('[data-kind="sprout"]').forEach((node) => {
      if (step.focus.includes('sprout')) node.removeAttribute('data-guide-away');
      else node.setAttribute('data-guide-away', 'true');
    });
  });

  const go = (to: number) => {
    setIndex(Math.max(0, Math.min(GUIDE_STEPS.length - 1, to)));
  };

  return (
    <main className="flex min-h-screen flex-col bg-forest-950 font-sans text-forest-50">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-forest-800 px-6 py-3">
        <div className="flex items-center gap-2.5">
          <Trees className="h-5 w-5 text-forest-400" aria-hidden="true" />
          <span className="font-serif text-lg font-semibold">How to read your grove</span>
        </div>
        <button
          type="button"
          className="text-sm text-forest-300 underline-offset-4 hover:text-forest-50 hover:underline"
          onClick={onDone}
        >
          Skip the tour
        </button>
      </header>

      <p className="shrink-0 px-6 pt-3 text-xs text-forest-400">
        This is an example grove, not your own tabs.
      </p>

      <div ref={stage} className="h-[44vh] min-h-[280px] shrink-0">
        <GroveCanvas
          key={`${index}-${run}`}
          grove={changed ? step.after : step.before}
          growTimeScale={1.35}
        />
      </div>

      <section
        aria-label="Tour step"
        className="flex shrink-0 flex-wrap items-end justify-between gap-x-10 gap-y-5 border-t border-forest-800 px-6 py-5"
      >
        <div className="min-w-0 flex-1 basis-[420px]">
          <p className="text-xs font-semibold uppercase tracking-wider text-forest-400">
            Step {index + 1} of {GUIDE_STEPS.length}
          </p>
          <h1
            ref={heading}
            tabIndex={-1}
            className="mt-1.5 font-serif text-2xl font-semibold leading-tight focus:outline-none"
          >
            {step.title}
          </h1>
          <dl className="mt-3 grid max-w-3xl grid-cols-1 gap-x-4 gap-y-1.5 text-[15px] leading-relaxed sm:grid-cols-[9.5em_1fr]">
            <dt className="font-medium text-forest-400">In your browser</dt>
            <dd className="text-forest-50">{step.browser}</dd>
            <dt className="font-medium text-forest-400">In your grove</dt>
            <dd className="text-forest-50">{step.grove}</dd>
          </dl>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={quiet} disabled={index === 0} onClick={() => go(index - 1)}>
            Back
          </button>
          <button type="button" className={quiet} onClick={() => setRun(run + 1)}>
            Play again
          </button>
          {last ? (
            <button type="button" className={primary} onClick={onDone}>
              Open my grove
            </button>
          ) : (
            <button type="button" className={primary} onClick={() => go(index + 1)}>
              Next
            </button>
          )}
        </div>
      </section>

      <section aria-label="What each thing means" className="border-t border-forest-800 px-6 py-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-forest-400">
          What each thing means
        </h2>
        <ul className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {GUIDE_KEY.map((item) => (
            <li key={item.id} className="flex items-center gap-3 text-sm text-forest-300">
              <KeyIcon id={item.id} />
              <span>
                <span className="font-medium text-forest-50">{item.name}</span> {item.meaning}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
};
