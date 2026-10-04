import React, { useEffect, useRef, useState } from 'react';
import { Trees } from 'lucide-react';

interface OnboardingProps {
  /** The first name to greet, when the account has one. */
  name?: string;
  /** Finished or skipped. */
  onDone: () => void;
}

export const ONBOARDING_STEPS = [
  {
    title: 'Browse as you normally do',
    body: 'TabForest notes which tabs you open and how long you stay on them. Private pages rest in the Hollow and are never recorded.',
  },
  {
    title: 'Grow your grove',
    body: 'Press “Grow grove”. Your open tabs gather into trees, one for each goal TabForest can tell apart. A thicker trunk means more of your attention went there.',
  },
  {
    title: 'Check what it says',
    body: 'Every claim carries a label: Stated, Sourced, Inferred or Hypothesis. Click a label to see the tabs behind it, then confirm, edit or dismiss the claim.',
  },
] as const;

const quiet =
  'rounded-md border border-forest-700 px-4 py-2 text-sm text-forest-200 hover:border-forest-500 hover:text-forest-50';
const primary =
  'rounded-md bg-forest-600 px-4 py-2 text-sm font-medium text-forest-50 hover:bg-forest-500';

/** Shown once, after the first sign-in (GET /api/me says first_sign_in). */
export const Onboarding: React.FC<OnboardingProps> = ({ name, onDone }) => {
  const [index, setIndex] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const step = ONBOARDING_STEPS[index];
  const last = index === ONBOARDING_STEPS.length - 1;

  // Each step is announced and becomes the start of the focus order.
  useEffect(() => {
    heading.current?.focus();
  }, [index]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-forest-950 px-6 py-12 font-sans text-forest-50">
      <section aria-label="Getting started" className="w-full max-w-md">
        <div className="flex items-center gap-2.5">
          <Trees className="h-6 w-6 text-forest-400" aria-hidden="true" />
          <span className="font-serif text-xl font-semibold">TabForest</span>
        </div>

        <p className="mt-8 text-sm text-forest-300">
          {name ? `Welcome, ${name}.` : 'Welcome.'} Step {index + 1} of {ONBOARDING_STEPS.length}
        </p>
        <h1
          ref={heading}
          tabIndex={-1}
          className="mt-2 font-serif text-3xl font-semibold leading-tight focus:outline-none"
        >
          {step.title}
        </h1>
        <p className="mt-4 min-h-[6rem] text-sm leading-relaxed text-forest-100">{step.body}</p>

        <div className="mt-8 flex items-center gap-3">
          {index > 0 && (
            <button type="button" className={quiet} onClick={() => setIndex(index - 1)}>
              Back
            </button>
          )}
          {last ? (
            <button type="button" className={primary} onClick={onDone}>
              Open my grove
            </button>
          ) : (
            <button type="button" className={primary} onClick={() => setIndex(index + 1)}>
              Next
            </button>
          )}
          {!last && (
            <button
              type="button"
              className="ml-auto text-sm text-forest-300 underline-offset-4 hover:text-forest-50 hover:underline"
              onClick={onDone}
            >
              Skip
            </button>
          )}
        </div>
      </section>
    </main>
  );
};
