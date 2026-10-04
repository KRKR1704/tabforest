import React, { useMemo, useState } from 'react';
import { Trees } from 'lucide-react';
import { GUIDE_KEY, GUIDE_SHOWCASE } from '../lib/guideGrove';
import { countGroveTabs } from '../lib/grove';
import { KeyIcon } from '../screens/GroveGuide';
import { GroveCanvas } from '../viz/GroveCanvas';
import {
  EXTENSION_ZIP_URL,
  HOW_IT_WORKS,
  INSTALL_NOTES,
  INSTALL_STEPS,
  KEY_DETAILS,
  NEVER_COLLECTED,
  PRIVACY_PARAGRAPH,
  SKIPPED_ENTIRELY,
  WHAT_HAPPENS_NEXT,
} from './content';

const eyebrow = 'text-xs font-semibold uppercase tracking-[0.09em] text-forest-400';
const heading = 'mt-2 max-w-[22ch] font-serif text-3xl font-semibold leading-tight text-forest-50 [text-wrap:balance]';
const primary =
  'inline-block rounded-md bg-forest-600 px-5 py-3 text-[15px] font-medium text-forest-50 no-underline hover:bg-forest-500';
const quiet =
  'inline-block rounded-md border border-forest-700 px-5 py-3 text-[15px] font-medium text-forest-50 hover:border-forest-400';
const section = 'border-t border-forest-800 py-14';
const wrap = 'mx-auto max-w-[1120px] px-6';

/** The example tabs in the order they would sit in a browser: mixed up, not grouped by goal. */
function mixedTabs(): Array<{ ref: string; title: string }> {
  const groups = [...GUIDE_SHOWCASE.trees, ...GUIDE_SHOWCASE.sprouts].map((owner) =>
    owner.tabs.map((tab) => ({ ref: tab.tab_ref, title: tab.title }))
  );
  const mixed: Array<{ ref: string; title: string }> = [];
  for (let i = 0; groups.some((group) => i < group.length); i++) {
    for (const group of groups) if (i < group.length) mixed.push(group[i]);
  }
  return mixed;
}

/**
 * The public landing page: what TabForest is, a demo on an example grove, what
 * each thing in the grove means, the privacy statement, and how to install it.
 */
export const Landing: React.FC = () => {
  const [growKey, setGrowKey] = useState(0);
  const tabs = useMemo(mixedTabs, []);
  // A fresh copy for each replay: the canvas starts its grow when it is handed a new grove.
  const grove = useMemo(() => ({ ...GUIDE_SHOWCASE }), [growKey]);
  const treeCount = GUIDE_SHOWCASE.trees.length;
  const tabCount = countGroveTabs(GUIDE_SHOWCASE);

  const watch = () => {
    document.getElementById('demo')?.scrollIntoView?.({ block: 'center' });
    setGrowKey((key) => key + 1);
  };

  return (
    <div className="min-h-screen bg-forest-950 font-sans text-[15px] leading-relaxed text-forest-50">
      <header>
        <div className={`${wrap} flex flex-wrap items-center gap-x-7 gap-y-3 py-5`}>
          <div className="flex items-center gap-2.5 font-serif text-xl font-semibold">
            <Trees className="h-6 w-6 text-forest-400" aria-hidden="true" />
            TabForest
          </div>
          <nav aria-label="Page" className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-forest-300">
            <a className="no-underline hover:text-forest-50" href="#how">How it works</a>
            <a className="no-underline hover:text-forest-50" href="#key">What it shows</a>
            <a className="no-underline hover:text-forest-50" href="#privacy">Privacy</a>
            <a className="no-underline hover:text-forest-50" href="#install">Install</a>
          </nav>
          <a href="#install" className="ml-auto rounded-md bg-forest-600 px-4 py-2 text-sm font-medium text-forest-50 no-underline hover:bg-forest-500">
            Get TabForest for Chrome
          </a>
        </div>
      </header>

      <main>
        <section className="pb-8 pt-10">
          <div className={wrap}>
            <h1 className="max-w-[15ch] font-serif text-[clamp(34px,5.2vw,58px)] font-semibold leading-[1.08] [text-wrap:balance]">
              You opened those tabs <em className="font-medium text-amberCanopy-light">for a reason.</em>
            </h1>
            <p className="mt-5 max-w-[56ch] text-[17px] text-forest-300">
              TabForest turns the tabs you have open into a small forest. Each tree is one thing you are
              working on, so you can see at a glance what is growing, what is waiting on an answer, and
              what you forgot about.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-3">
              <a href="#install" className={primary}>Get TabForest for Chrome</a>
              <button type="button" className={quiet} onClick={watch}>
                Watch tabs become a grove
              </button>
              <span className="text-[13px] text-forest-300">Free. Tested in Google Chrome.</span>
            </div>

            <div id="demo" className="mt-9 overflow-hidden rounded-lg border border-forest-700">
              <div
                aria-hidden="true"
                data-sorted={growKey > 0 ? 'true' : 'false'}
                className="flex gap-[3px] overflow-hidden border-b border-forest-800 bg-forest-900 px-2 pt-2"
              >
                {tabs.map((tab) => (
                  <div
                    key={tab.ref}
                    className="flex h-[26px] min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-t-md bg-forest-800 px-1.5 text-[10.5px] text-forest-300"
                  >
                    <span className="h-3 w-3 shrink-0 rounded-sm bg-forest-700 text-center text-[8px] font-semibold leading-3 text-forest-50">
                      {tab.title.charAt(0)}
                    </span>
                    <span className="overflow-hidden text-ellipsis">{tab.title}</span>
                  </div>
                ))}
              </div>
              <div className="h-[min(56vw,440px)] min-h-[260px]">
                <GroveCanvas grove={grove} growKey={growKey} />
              </div>
              <p className="border-t border-forest-800 bg-forest-900 px-4 py-3 text-[13px] text-forest-300">
                An example: {tabCount} tabs, {treeCount} goals. Your tabs stay open exactly as they are;
                the grove only shows what they are for.
              </p>
            </div>
          </div>
        </section>

        <section id="how" className={section}>
          <div className={wrap}>
            <p className={eyebrow}>How it works</p>
            <h2 className={heading}>Three steps, and the first one takes two minutes.</h2>
            <ol className="mt-8 grid gap-x-10 gap-y-7 sm:grid-cols-3">
              {HOW_IT_WORKS.map((step, index) => (
                <li key={step.title} className="border-t border-forest-700 pt-4">
                  <span className="font-serif text-3xl font-medium text-amberCanopy-light" aria-hidden="true">
                    {index + 1}
                  </span>
                  <h3 className="mb-1.5 mt-1 text-[17px] font-semibold">{step.title}</h3>
                  <p className="text-forest-300">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="key" className={section}>
          <div className={wrap}>
            <p className={eyebrow}>What it shows</p>
            <h2 className={heading}>Everything in the grove stands for something real.</h2>
            <p className="mt-3 max-w-[60ch] text-forest-300">
              No charts to learn. If you can read a garden, you can read your grove.
            </p>
            <ul className="mt-8 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
              {GUIDE_KEY.map((item) => (
                <li key={item.id} className="flex items-start gap-4 border-t border-forest-800 py-4">
                  <span className="shrink-0 [&>svg]:h-11 [&>svg]:w-11">
                    <KeyIcon id={item.id} />
                  </span>
                  <span>
                    <span className="block text-base font-semibold">{item.name}</span>
                    <span className="text-sm text-forest-300">{KEY_DETAILS[item.id]}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="privacy" className={section}>
          <div className={wrap}>
            <p className={eyebrow}>Privacy</p>
            <h2 className={heading}>It watches your tabs, so here is exactly what that means.</h2>
            <blockquote className="mt-7 max-w-[66ch] border-l-2 border-forest-700 pl-5 text-[17px] leading-relaxed">
              {PRIVACY_PARAGRAPH}
              <footer className="pt-2.5 text-[13px] text-forest-300">
                From TabForest’s privacy document, word for word.
              </footer>
            </blockquote>
            <div className="mt-8 grid gap-x-12 gap-y-6 sm:grid-cols-2">
              <div>
                <h3 className={eyebrow}>Never collected</h3>
                <ul className="mt-2 list-disc pl-5 text-forest-300">
                  {NEVER_COLLECTED.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </div>
              <div>
                <h3 className={eyebrow}>Skipped entirely</h3>
                <ul className="mt-2 list-disc pl-5 text-forest-300">
                  {SKIPPED_ENTIRELY.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section id="install" className={section}>
          <div className={wrap}>
            <p className={eyebrow}>Install</p>
            <h2 className={heading}>Seven steps, about two minutes.</h2>
            <p className="mt-3 max-w-[60ch] text-forest-300">
              TabForest is not on the Chrome Web Store yet, so you load it into Chrome yourself.
            </p>
            <p className="mt-6">
              <a href={EXTENSION_ZIP_URL} className={primary}>Download TabForest (.zip)</a>
            </p>

            <div className="mt-8 grid gap-x-14 gap-y-8 lg:grid-cols-[3fr_2fr]">
              <ol aria-label="Install steps">
                {INSTALL_STEPS.map((step, index) => (
                  <li key={index} className="grid grid-cols-[2.2em_1fr] gap-x-2 border-t border-forest-800 py-3 text-base">
                    <span className="font-serif text-xl font-medium leading-snug text-amberCanopy-light" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span>
                      {step.text}
                      {step.mark &&
                        (step.mark.kind === 'address' ? (
                          <code className="rounded-sm border border-forest-800 bg-forest-900 px-1.5 py-px font-mono text-sm [overflow-wrap:anywhere]">
                            {step.mark.text}
                          </code>
                        ) : (
                          <span className="font-medium">“{step.mark.text}”</span>
                        ))}
                      {step.after}
                    </span>
                  </li>
                ))}
              </ol>

              <div>
                {INSTALL_NOTES.map((note) => (
                  <div key={note.heading} className="mb-5">
                    <h3 className={eyebrow}>{note.heading}</h3>
                    {note.lines.map((line) => (
                      <p key={line} className="mt-1.5 text-sm text-forest-300">{line}</p>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <ol aria-label="What happens next" className="mt-8 flex flex-wrap items-center gap-x-3.5 gap-y-2 text-sm text-forest-50">
              {WHAT_HAPPENS_NEXT.map((line, index) => (
                <li key={line} className="flex items-center gap-3.5">
                  {index > 0 && <span className="text-forest-700" aria-hidden="true">→</span>}
                  {line}
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <footer className="border-t border-forest-800 pb-10 pt-6 text-[13px] text-forest-300">
        <div className={wrap}>TabForest · built at GirlHacks 2026</div>
      </footer>
    </div>
  );
};
