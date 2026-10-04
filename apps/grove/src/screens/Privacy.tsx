import React, { useCallback, useEffect, useState } from 'react';
import { sendBridgeMessage } from '../adapters/bridge';
import { isMockMode } from '../adapters/grove';
import {
  RETENTION_OPTIONS,
  deleteAccount,
  deleteForest,
  getPrivacy,
  patchPrivacy,
  type PrivacySettings,
  type RetentionDays,
} from '../adapters/privacy';
import { formatWhen } from '../lib/contextCard';
import { clearLastGrove } from '../lib/lastGrove';
import {
  HOLLOW_CATEGORIES,
  describeCapture,
  isPaused,
  normalizeDomain,
  pauseUntil,
  type PauseOption,
} from '../lib/privacy';
import { clearSavedWorkContexts } from '../lib/savedWorkContexts';
import { useBridgeStore } from '../store/useBridgeStore';
import { useGroveStore } from '../store/useGroveStore';
import { useResumeStore } from '../store/useResumeStore';

interface PrivacyProps {
  /** How often the "what we send" preview refreshes. */
  previewIntervalMs?: number;
}

const buttonClass =
  'rounded-sm border border-forest-700 px-2.5 py-1 text-xs text-forest-200 hover:border-forest-500 hover:text-forest-50 disabled:opacity-50';
const dangerClass =
  'rounded-sm border border-amberCanopy-dark px-2.5 py-1 text-xs text-amberCanopy-light hover:border-amberCanopy hover:text-forest-50 disabled:opacity-50';
const inputClass =
  'w-full rounded-sm border border-forest-700 bg-forest-950 px-2 py-1.5 text-sm text-forest-50 placeholder:text-forest-500';
const headingClass = 'text-xs font-medium uppercase tracking-wider text-forest-400';

const PAUSE_OPTIONS: Array<{ id: PauseOption; label: string }> = [
  { id: 'hour', label: 'Pause for 1 hour' },
  { id: 'tomorrow', label: 'Pause until tomorrow' },
  { id: 'resumed', label: 'Pause until I resume' },
];

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

const Section: React.FC<{ id: string; title: string; children: React.ReactNode }> = ({
  id,
  title,
  children,
}) => (
  <section aria-labelledby={id} className="border-t border-forest-800 py-6 first:border-t-0">
    <h2 id={id} className={headingClass}>
      {title}
    </h2>
    {children}
  </section>
);

export const Privacy: React.FC<PrivacyProps> = ({ previewIntervalMs = 5000 }) => {
  const grove = useGroveStore((state) => state.grove);
  const setGrove = useGroveStore((state) => state.setGrove);
  const hollowCount = useBridgeStore((state) => state.hollowCount);
  const fetchHollowCount = useBridgeStore((state) => state.fetchHollowCount);
  const sendPreview = useBridgeStore((state) => state.sendPreview);
  const fetchSendPreview = useBridgeStore((state) => state.fetchSendPreview);
  const wipeLocal = useBridgeStore((state) => state.wipeLocal);

  const [settings, setSettings] = useState<PrivacySettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [domainDraft, setDomainDraft] = useState('');
  const [confirmForest, setConfirmForest] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const outcome = await getPrivacy();
    if (outcome.ok) {
      setSettings(outcome.value);
      setLoadError(null);
    } else {
      setLoadError(outcome.message);
    }
  }, []);

  useEffect(() => {
    void load();
    void fetchHollowCount();
  }, [load, fetchHollowCount]);

  // "What we send" is live: it shows the next batch as it stands right now.
  useEffect(() => {
    void fetchSendPreview();
    const timer = setInterval(() => void fetchSendPreview(), previewIntervalMs);
    return () => clearInterval(timer);
  }, [fetchSendPreview, previewIntervalMs]);

  const say = (message: string) => {
    setError(null);
    setNotice(message);
  };
  const fail = (message: string) => {
    setNotice(null);
    setError(message);
  };

  // Capture runs in the extension, so pause and exclusions are told to it over
  // the bridge; it syncs them to the server. The stand-in has no extension to
  // do that, so there the page records the change itself.
  const pause = async (until: string | null) => {
    const reply = await sendBridgeMessage('PAUSE', { until });
    if (!reply.ok) return fail('The extension could not change capture.');
    if (isMockMode()) await patchPrivacy({ paused_until: until });
    setSettings((current) => (current ? { ...current, paused_until: until } : current));
    say(until ? 'Capture is paused.' : 'Capture has resumed.');
  };

  const exclude = async (event: React.FormEvent) => {
    event.preventDefault();
    const domain = normalizeDomain(domainDraft);
    if (!domain) return fail('Enter a site like mybank.com.');
    const reply = await sendBridgeMessage('EXCLUDE_DOMAIN', { domain });
    if (!reply.ok) return fail(`Could not exclude ${domain}.`);
    if (isMockMode()) await patchPrivacy({ excluded_domains_add: [domain] });
    setSettings((current) =>
      current && !current.excluded_domains.includes(domain)
        ? { ...current, excluded_domains: [...current.excluded_domains, domain] }
        : current
    );
    setDomainDraft('');
    say(`${domain} will no longer be analyzed.`);
  };

  const include = async (domain: string) => {
    const outcome = await patchPrivacy({ excluded_domains_remove: [domain] });
    if (!outcome.ok) return fail(outcome.message);
    setSettings(outcome.value);
    say(`${domain} can be analyzed again.`);
  };

  const setRetention = async (days: RetentionDays) => {
    const outcome = await patchPrivacy({ retention_days: days });
    if (!outcome.ok) return fail(outcome.message);
    setSettings(outcome.value);
    say(`Your browsing memory is now kept for ${days} days.`);
  };

  const removeForest = async (projectId: string, name: string) => {
    setBusy(true);
    const outcome = await deleteForest(projectId);
    setBusy(false);
    setConfirmForest(null);
    if (!outcome.ok) return fail(`${name} was not deleted. ${outcome.message}`);
    const current = useGroveStore.getState().grove;
    if (current) {
      setGrove({ ...current, trees: current.trees.filter((tree) => tree.cluster_ref !== projectId) });
    }
    if (useResumeStore.getState().resume?.project_id === projectId) {
      useResumeStore.getState().setResume(null);
    }
    say(`${name} was deleted: ${plural(outcome.value.total, 'row')} removed.`);
  };

  const removeEverything = async () => {
    setBusy(true);
    const outcome = await deleteAccount();
    if (!outcome.ok) {
      setBusy(false);
      setConfirmAll(false);
      return fail(`Nothing was deleted. ${outcome.message}`);
    }
    // The server is empty; now empty this device too.
    await wipeLocal();
    clearLastGrove();
    clearSavedWorkContexts();
    setGrove(null);
    useResumeStore.getState().setResume(null);
    setBusy(false);
    setConfirmAll(false);
    await load();
    say(`Everything was deleted: ${plural(outcome.value.total, 'row')} on the server, and all data on this device.`);
  };

  const paused = settings ? isPaused(settings.paused_until) : false;
  const trees = (grove?.trees ?? []).filter((tree) => !tree.pending);

  return (
    <div className="mx-auto max-w-3xl px-8">
      {(notice || error) && (
        <p
          role={error ? 'alert' : 'status'}
          className={`border-b border-forest-800 py-3 text-sm ${
            error ? 'text-amberCanopy-light' : 'text-forest-100'
          }`}
        >
          {error ?? notice}
        </p>
      )}
      {loadError && (
        <p role="alert" className="border-b border-forest-800 py-3 text-sm text-amberCanopy-light">
          Your privacy settings could not be loaded. {loadError}{' '}
          <button type="button" className={buttonClass} onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}

      <Section id="privacy-capture" title="Capture">
        <p className="mt-2 font-serif text-lg text-forest-50">
          {settings ? describeCapture(settings.paused_until) : 'Capture status unknown'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {paused ? (
            <button type="button" className={buttonClass} onClick={() => void pause(null)}>
              Resume capture
            </button>
          ) : (
            PAUSE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={buttonClass}
                onClick={() => void pause(pauseUntil(option.id))}
              >
                {option.label}
              </button>
            ))
          )}
        </div>
      </Section>

      <Section id="privacy-hollow" title="The Hollow">
        <p className="mt-2 text-sm text-forest-100">
          {hollowCount === 0
            ? 'No tabs are resting in the Hollow.'
            : `${plural(hollowCount, 'tab')} ${hollowCount === 1 ? 'is' : 'are'} resting in the Hollow.`}{' '}
          Sensitive browsing never enters the forest: these produce no events at all.
        </p>
        <ul className="mt-3 space-y-1.5">
          {HOLLOW_CATEGORIES.map((category) => (
            <li key={category.name} className="text-sm">
              <span className="text-forest-50">{category.name}</span>
              <span className="text-forest-400"> · {category.detail}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="privacy-excluded" title="Never analyze these sites">
        <form onSubmit={(event) => void exclude(event)} className="mt-2 flex gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Site to exclude</span>
            <input
              value={domainDraft}
              onChange={(event) => setDomainDraft(event.target.value)}
              placeholder="mybank.com"
              className={inputClass}
            />
          </label>
          <button type="submit" className={buttonClass}>
            Exclude site
          </button>
        </form>
        <p className="mt-1 text-xs text-forest-400">
          Subdomains are covered too: mybank.com also covers www.mybank.com.
        </p>
        {settings && settings.excluded_domains.length > 0 && (
          <ul aria-label="Excluded sites" className="mt-3 divide-y divide-forest-800">
            {settings.excluded_domains.map((domain) => (
              <li key={domain} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span className="text-forest-50">{domain}</span>
                <button
                  type="button"
                  className={buttonClass}
                  aria-label={`Stop excluding ${domain}`}
                  onClick={() => void include(domain)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="privacy-retention" title="Retention">
        <p className="mt-2 text-sm text-forest-100">
          Browsing events older than this are deleted every night.
        </p>
        <div role="radiogroup" aria-labelledby="privacy-retention" className="mt-3 flex gap-5">
          {RETENTION_OPTIONS.map((days) => (
            <label key={days} className="flex items-center gap-1.5 text-sm text-forest-100">
              <input
                type="radio"
                name="retention"
                disabled={!settings}
                checked={settings?.retention_days === days}
                onChange={() => void setRetention(days)}
                className="accent-forest-400"
              />
              {days} days
            </label>
          ))}
        </div>
      </Section>

      <Section id="privacy-preview" title="What we send">
        <div className="mt-2 flex items-start justify-between gap-4">
          <p className="text-sm text-forest-100">
            {sendPreview
              ? `${plural(sendPreview.pending_count, 'event')} waiting in the next batch.`
              : 'Reading the next batch…'}{' '}
            Only the event type, the site and the time. No page text, and no full address.
          </p>
          <button type="button" className={buttonClass} onClick={() => void fetchSendPreview()}>
            Refresh
          </button>
        </div>
        {sendPreview && sendPreview.sample_events.length > 0 && (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-forest-400">
              <tr>
                <th scope="col" className="py-1 pr-4 font-medium">Event</th>
                <th scope="col" className="py-1 pr-4 font-medium">Site</th>
                <th scope="col" className="py-1 font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-forest-800">
              {sendPreview.sample_events.map((event) => (
                <tr key={event.event_id}>
                  <td className="py-1.5 pr-4 text-forest-50">{event.event_type}</td>
                  <td className="py-1.5 pr-4 text-forest-100">{event.domain ?? '—'}</td>
                  <td className="py-1.5 text-forest-300">{formatWhen(event.ts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section id="privacy-delete" title="Delete">
        {trees.length === 0 ? (
          <p className="mt-2 text-sm text-forest-400">There are no forests to delete.</p>
        ) : (
          <ul aria-label="Forests" className="mt-2 divide-y divide-forest-800">
            {trees.map((tree) => (
              <li key={tree.cluster_ref} className="py-2 text-sm">
                {confirmForest === tree.cluster_ref ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-forest-50">
                      Delete {tree.project.name} and everything derived from it?
                    </span>
                    <span className="flex gap-2">
                      <button
                        type="button"
                        className={dangerClass}
                        disabled={busy}
                        onClick={() => void removeForest(tree.cluster_ref, tree.project.name)}
                      >
                        Delete
                      </button>
                      <button type="button" className={buttonClass} onClick={() => setConfirmForest(null)}>
                        Cancel
                      </button>
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-forest-50">{tree.project.name}</span>
                    <button
                      type="button"
                      className={buttonClass}
                      aria-label={`Delete forest ${tree.project.name}`}
                      onClick={() => setConfirmForest(tree.cluster_ref)}
                    >
                      Delete forest
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5">
          <button type="button" className={dangerClass} onClick={() => setConfirmAll(true)}>
            Delete all my memory
          </button>
        </div>
      </Section>

      {confirmAll && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-forest-950/80 px-6">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-all-title"
            aria-describedby="delete-all-body"
            className="w-full max-w-md rounded-md border border-forest-700 bg-forest-900 p-6"
          >
            <h2 id="delete-all-title" className="font-serif text-xl font-semibold text-forest-50">
              Delete all your memory?
            </h2>
            <p id="delete-all-body" className="mt-3 text-sm text-forest-100">
              This removes every forest, saved context, note and browsing event from the server, and
              everything TabForest keeps on this device. It cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={buttonClass} autoFocus onClick={() => setConfirmAll(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={dangerClass}
                disabled={busy}
                onClick={() => void removeEverything()}
              >
                {busy ? 'Deleting…' : 'Delete everything'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
