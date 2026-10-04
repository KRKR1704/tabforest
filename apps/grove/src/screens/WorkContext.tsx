import React, { useEffect, useRef, useState } from 'react';
import {
  ACCEPTED_EXTENSIONS,
  MAX_ITEM_CHARS,
  analyzeWorkContext,
  fileProblem,
  toWorkItems,
  uploadWorkContext,
} from '../adapters/workContext';
import { WorkContextCard } from '../components/WorkContextCard';
import { formatWhen } from '../lib/contextCard';
import {
  listSavedWorkContexts,
  removeSavedWorkContext,
  saveWorkContext,
  type SavedWorkContext,
} from '../lib/savedWorkContexts';
import { useBridgeStore } from '../store/useBridgeStore';
import type { WorkContextResponse } from '../types';

const buttonClass =
  'rounded-sm border border-forest-700 px-2.5 py-1 text-xs text-forest-200 hover:border-forest-500 hover:text-forest-50 disabled:opacity-50';
const inputClass =
  'w-full rounded-sm border border-forest-700 bg-forest-950 px-2 py-1.5 text-sm text-forest-50 placeholder:text-forest-500';
const headingClass = 'text-xs font-medium uppercase tracking-wider text-forest-400';

const SOURCE_NAMES: Record<string, string> = {
  selection: 'selected text',
  page_text: 'page text',
  paste: 'pasted',
  upload: 'uploaded',
};

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const WorkContext: React.FC = () => {
  const workItems = useBridgeStore((state) => state.workItems);
  const fetchWorkItems = useBridgeStore((state) => state.fetchWorkItems);
  const clearWorkItems = useBridgeStore((state) => state.clearWorkItems);

  const [files, setFiles] = useState<File[]>([]);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WorkContextResponse | null>(null);
  const [isSample, setIsSample] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedWorkContext[]>(() => listSavedWorkContexts());
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetchWorkItems();
  }, [fetchWorkItems]);

  const hasInput = workItems.length > 0 || files.length > 0 || pasteText.trim().length > 0;

  const addFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    const problem = picked.map(fileProblem).find((message) => message !== null);
    setError(problem ?? null);
    setFiles((current) => [...current, ...picked.filter((file) => fileProblem(file) === null)]);
    if (fileInput.current) fileInput.current.value = '';
  };

  const reconstruct = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const items = toWorkItems(workItems, { title: pasteTitle, text: pasteText });
    // Files need the multipart endpoint; everything else rides along in items_json.
    const outcome =
      files.length > 0 ? await uploadWorkContext(files, items) : await analyzeWorkContext(items);
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    setResult(outcome.result);
    setIsSample(outcome.sample);
  };

  const copyBrief = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.handoff_brief);
      setNotice('Handoff brief copied.');
    } catch {
      setNotice('Could not copy. Select the brief below and copy it by hand.');
    }
  };

  const save = () => {
    if (!result) return;
    setSaved(saveWorkContext(result));
    setNotice('Saved on this device.');
  };

  return (
    <div className="mx-auto max-w-4xl px-8 py-6">
      <p className="text-sm text-forest-300">
        TabForest reads only what you hand it here. Nothing is read in the background.
      </p>

      <section className="mt-6" aria-labelledby="wc-captured">
        <div className="flex items-center justify-between gap-4">
          <h2 id="wc-captured" className={headingClass}>
            Captured pages · {workItems.length}
          </h2>
          {workItems.length > 0 && (
            <button type="button" className={buttonClass} onClick={() => void clearWorkItems()}>
              Clear captured pages
            </button>
          )}
        </div>
        {workItems.length === 0 ? (
          <p className="mt-2 text-sm text-forest-400">
            None yet. Right-click a page and choose “Add page to Work Context”.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-forest-800">
            {workItems.map((item) => (
              <li key={item.id} className="py-2 text-sm">
                <span className="text-forest-50">{item.title}</span>
                <span className="text-forest-400">
                  {' '}
                  · {SOURCE_NAMES[item.source_type] ?? item.source_type} ·{' '}
                  {Math.min(item.text.length, MAX_ITEM_CHARS).toLocaleString('en-US')} characters
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6" aria-labelledby="wc-upload">
        <h2 id="wc-upload" className={headingClass}>
          Upload
        </h2>
        <label className="mt-2 block text-sm text-forest-200">
          <span className="sr-only">Files to upload</span>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS.join(',')}
            onChange={(event) => addFiles(event.target.files)}
            className="text-sm text-forest-300 file:mr-3 file:rounded-sm file:border file:border-forest-700 file:bg-forest-900 file:px-2.5 file:py-1 file:text-xs file:text-forest-200"
          />
        </label>
        <p className="mt-1 text-xs text-forest-400">
          PDF, TXT, Markdown or VTT, up to 5 MB each. Text is extracted and the file is not kept.
        </p>
        {files.length > 0 && (
          <ul className="mt-2 divide-y divide-forest-800">
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span>
                  <span className="text-forest-50">{file.name}</span>
                  <span className="text-forest-400"> · {fileSize(file.size)}</span>
                </span>
                <button
                  type="button"
                  className={buttonClass}
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6" aria-labelledby="wc-paste">
        <h2 id="wc-paste" className={headingClass}>
          Paste
        </h2>
        <label className="mt-2 block">
          <span className="sr-only">Title of the pasted text</span>
          <input
            value={pasteTitle}
            onChange={(event) => setPasteTitle(event.target.value)}
            placeholder="What is this? e.g. Meeting notes, Sept 22"
            className={inputClass}
          />
        </label>
        <label className="mt-2 block">
          <span className="sr-only">Pasted text</span>
          <textarea
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            rows={5}
            placeholder="Meeting notes or a chat excerpt"
            className={inputClass}
          />
        </label>
        <p className="mt-1 text-xs text-forest-400">
          {pasteText.length.toLocaleString('en-US')} of {MAX_ITEM_CHARS.toLocaleString('en-US')} characters
          {pasteText.length > MAX_ITEM_CHARS && ' · only the first 12,000 are sent'}
        </p>
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void reconstruct()}
          disabled={!hasInput || busy}
          className="rounded-md bg-forest-600 px-4 py-1.5 text-sm font-medium text-forest-50 hover:bg-forest-500 disabled:opacity-60"
        >
          {busy ? 'Reconstructing…' : 'Reconstruct'}
        </button>
        {error && (
          <p role="alert" className="text-sm text-amberCanopy-light">
            {error}
          </p>
        )}
      </div>

      {result && (
        <div className="mt-8 border-t border-forest-800 pt-6">
          {isSample && (
            <p role="alert" className="mb-4 text-sm text-amberCanopy-light">
              The service could not be reached. This is a sample result, not built from your items.
            </p>
          )}
          <WorkContextCard result={result} />

          <section className="border-t border-forest-800 py-4" aria-labelledby="wc-brief">
            <h3 id="wc-brief" className={headingClass}>
              Handoff brief
            </h3>
            <p className="mt-2 whitespace-pre-wrap text-sm text-forest-100">{result.handoff_brief}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" className={buttonClass} onClick={() => void copyBrief()}>
                Copy handoff brief
              </button>
              <button type="button" className={buttonClass} onClick={save}>
                Save as work context
              </button>
              {notice && (
                <p role="status" className="text-sm text-forest-200">
                  {notice}
                </p>
              )}
            </div>
          </section>
        </div>
      )}

      {saved.length > 0 && (
        <section className="mt-8 border-t border-forest-800 pt-6" aria-labelledby="wc-saved">
          <h2 id="wc-saved" className={headingClass}>
            Saved work contexts · on this device
          </h2>
          <ul className="mt-2 divide-y divide-forest-800">
            {saved.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span>
                  <span className="text-forest-50">{item.result.project}</span>
                  <span className="text-forest-400"> · saved {formatWhen(item.saved_at)}</span>
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    className={buttonClass}
                    aria-label={`Open ${item.result.project}`}
                    onClick={() => {
                      setResult(item.result);
                      setIsSample(false);
                      setNotice(null);
                      setError(null);
                    }}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    aria-label={`Delete ${item.result.project}`}
                    onClick={() => setSaved(removeSavedWorkContext(item.id))}
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
