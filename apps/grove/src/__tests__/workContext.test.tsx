import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import workContextContract from '@contracts/work-context.example.json';
import { App } from '../App';
import { resetMockBridge } from '../adapters/bridge';
import {
  MAX_FILE_BYTES,
  MAX_ITEM_CHARS,
  SAMPLE_WORK_CONTEXT,
  analyzeWorkContext,
  fileProblem,
  toWorkItems,
  uploadWorkContext,
} from '../adapters/workContext';
import { WorkContextCard } from '../components/WorkContextCard';
import {
  clearSavedWorkContexts,
  listSavedWorkContexts,
  removeSavedWorkContext,
  saveWorkContext,
} from '../lib/savedWorkContexts';
import { WorkContext } from '../screens/WorkContext';
import { useBridgeStore } from '../store/useBridgeStore';
import { useGroveStore } from '../store/useGroveStore';
import { mockGroveResponse } from '../mocks/mockData';
import type { WorkContextResponse, WorkItem, WorkItemInput } from '../types';

const analyzeExample = workContextContract.examples[0];
const contractItems = (analyzeExample.request.body as { items: WorkItemInput[] }).items;
const sample = SAMPLE_WORK_CONTEXT;

const captured = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: 'wi-x',
  title: 'CAM-142',
  url: 'https://jira.contoso.example/browse/CAM-142?focusedId=9#comment',
  text: 'Goal: migrate customer authentication to Azure.',
  source_type: 'page_text',
  captured_at: '2026-10-04T11:20:00Z',
  ...overrides,
});

const file = (name: string, size = 1200, type = 'text/plain') => {
  const made = new File(['x'], name, { type });
  Object.defineProperty(made, 'size', { value: size });
  return made;
};

beforeEach(() => {
  clearSavedWorkContexts();
  resetMockBridge();
  useBridgeStore.setState({ workItems: [] });
  useGroveStore.setState({ grove: mockGroveResponse, activeScreen: 'grove', isStreaming: false });
});

describe('work items', () => {
  it('sends a captured page with its domain only, never its URL', () => {
    const [item] = toWorkItems([captured()], null);
    expect(item).toEqual({
      kind: 'page',
      title: 'CAM-142',
      domain: 'jira.contoso.example',
      text: 'Goal: migrate customer authentication to Azure.',
    });
    expect(JSON.stringify(item)).not.toContain('focusedId');
  });

  it('sends pasted text without a domain, with a default title', () => {
    expect(toWorkItems([], { title: '  ', text: 'notes from the sync' })).toEqual([
      { kind: 'paste', title: 'Pasted notes', text: 'notes from the sync' },
    ]);
    expect(toWorkItems([], { title: 'Sync', text: '   ' })).toEqual([]);
  });

  it('sends a capture with no known site as pasted text, since a page must name its domain', () => {
    const [noUrl] = toWorkItems([captured({ url: undefined })], null);
    expect(noUrl.kind).toBe('paste');
    expect(noUrl).not.toHaveProperty('domain');
    const [pasted] = toWorkItems([captured({ source_type: 'paste' })], null);
    expect(pasted.kind).toBe('paste');
  });

  it('caps every item at 12,000 characters and skips empty captures', () => {
    const long = 'a'.repeat(MAX_ITEM_CHARS + 500);
    const items = toWorkItems([captured({ text: long }), captured({ text: '  ' })], {
      title: 'Notes',
      text: long,
    });
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.text.length === MAX_ITEM_CHARS)).toBe(true);
  });

  it('accepts only PDF, TXT, Markdown and VTT up to 5 MB', () => {
    expect(fileProblem(file('migration-doc.md'))).toBeNull();
    expect(fileProblem(file('teams-transcript.VTT'))).toBeNull();
    expect(fileProblem(file('deck.pptx'))).toBe('deck.pptx is not a PDF, TXT, Markdown or VTT file');
    expect(fileProblem(file('customer-deck.pdf', Math.round(7.4 * 1024 * 1024)))).toBe(
      'customer-deck.pdf is 7.4 MB; the limit is 5 MB per file'
    );
    expect(fileProblem(file('edge.pdf', MAX_FILE_BYTES))).toBeNull();
  });
});

describe('work context adapter (C6)', () => {
  it('stand-in: returns the contract reconstruction, and asks for input when there is none', async () => {
    expect(await analyzeWorkContext(contractItems)).toEqual({ ok: true, result: sample, sample: false });
    expect(await analyzeWorkContext([])).toEqual({
      ok: false,
      message: 'Add a page, a file or a note first.',
    });
  });

  it('refuses a bad file before anything is sent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await uploadWorkContext([file('deck.pptx')], contractItems)).toEqual({
      ok: false,
      message: 'deck.pptx is not a PDF, TXT, Markdown or VTT file',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
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

    it('sends the contract analyze request', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => analyzeExample.response.body,
      });

      const outcome = await analyzeWorkContext(contractItems);

      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url).endsWith('/api/work-context/analyze')).toBe(true);
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.headers.Authorization).toMatch(/^Bearer /);
      expect(JSON.parse(init.body)).toEqual(analyzeExample.request.body);
      expect(init.body).not.toContain('user_id');
      expect(outcome).toEqual({ ok: true, result: analyzeExample.response.body, sample: false });
    });

    it('uploads files[] with the other items in items_json, and lets the browser set the boundary', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => sample });
      const files = [file('migration-doc.md'), file('teams-transcript.vtt')];

      await uploadWorkContext(files, contractItems);

      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url).endsWith('/api/work-context/upload')).toBe(true);
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBeUndefined();
      const form = init.body as FormData;
      expect(form.getAll('files[]').map((f) => (f as File).name)).toEqual([
        'migration-doc.md',
        'teams-transcript.vtt',
      ]);
      expect(JSON.parse(form.get('items_json') as string)).toEqual(contractItems);
    });

    it('leaves items_json out when there are only files', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => sample });
      await uploadWorkContext([file('notes.txt')]);
      expect((fetchMock.mock.calls[0][1].body as FormData).has('items_json')).toBe(false);
    });

    it("shows the server's own words when it refuses, such as a file over 5 MB", async () => {
      const tooLarge = workContextContract.examples[1].response;
      fetchMock.mockResolvedValueOnce({ ok: false, status: tooLarge.status, json: async () => tooLarge.body });
      expect(await uploadWorkContext([file('customer-deck.pdf')])).toEqual({
        ok: false,
        message: 'customer-deck.pdf is 7.4 MB; the limit is 5 MB per file',
      });

      fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => { throw new Error('not json'); } });
      expect(await analyzeWorkContext(contractItems)).toEqual({
        ok: false,
        message: 'The server could not reconstruct this (500).',
      });
    });

    it('marks the result as a sample when the service cannot be reached', async () => {
      fetchMock.mockRejectedValueOnce(new Error('offline'));
      expect(await analyzeWorkContext(contractItems)).toEqual({ ok: true, result: sample, sample: true });
    });
  });
});

describe('saved work contexts (on this device)', () => {
  it('saves newest first, replaces the same run, and deletes', () => {
    saveWorkContext(sample);
    saveWorkContext({ ...sample, run_id: 'r_other', project: 'Other project' });
    saveWorkContext(sample);
    expect(listSavedWorkContexts().map((item) => item.result.project)).toEqual([
      'Customer Authentication Migration',
      'Other project',
    ]);
    expect(removeSavedWorkContext('r_other')).toHaveLength(1);
  });

  it('stores the reconstruction, not the page text that was handed over', () => {
    saveWorkContext(sample);
    const stored = localStorage.getItem('tabforest:work-contexts') ?? '';
    expect(stored).toContain('Azure Functions selected');
    expect(stored).not.toContain(contractItems[0].text.slice(0, 80));
  });

  it('ignores stored data that is not a list of work contexts', () => {
    localStorage.setItem('tabforest:work-contexts', '{"nope":1}');
    expect(listSavedWorkContexts()).toEqual([]);
    localStorage.setItem('tabforest:work-contexts', 'not json');
    expect(listSavedWorkContexts()).toEqual([]);
  });
});

describe('WorkContextCard', () => {
  const card = () => {
    render(<WorkContextCard result={sample} />);
    return within(screen.getByRole('article', { name: 'Reconstructed project' }));
  };
  const row = (id: string) => {
    const node = document.querySelector(`[data-claim-id="${id}"]`);
    if (!node) throw new Error(`no claim ${id}`);
    return within(node as HTMLElement);
  };

  it('names the project and its goal, with the quote the goal was sourced from', () => {
    const view = card();
    expect(view.getByRole('heading', { name: 'Customer Authentication Migration' })).toBeInTheDocument();
    const goal = row(sample.goal.id);
    expect(goal.getByText('Migrate customer authentication to Azure')).toBeInTheDocument();
    expect(goal.getByText('Sourced')).toBeInTheDocument();
    expect(goal.getByText(sample.goal.quote!)).toBeInTheDocument();
  });

  it('shows the decision with its verified quote, speaker, source and time', () => {
    card();
    const decision = row(sample.decisions[0].id);
    expect(decision.getByText('Azure Functions selected for the token service')).toBeInTheDocument();
    expect(
      decision.getByText("For the token service we'll go with Functions, Premium plan, one always-ready instance.")
    ).toBeInTheDocument();
    expect(
      decision.getByText('Marcus Lee · Teams transcript excerpt: CAM arch sync 2026-09-22 · 00:14:32')
    ).toBeInTheDocument();
  });

  it('shows the blocker with its quote', () => {
    card();
    const blocker = row(sample.blockers[0].id);
    expect(blocker.getByText('Customer test credentials have not arrived')).toBeInTheDocument();
    expect(blocker.getByText(/the customer test credentials have not arrived, so I can't run/)).toBeInTheDocument();
  });

  it('gives every sourced claim a quote, and no quote to an inferred one', () => {
    card();
    const claims = [
      sample.goal,
      ...sample.decisions,
      ...sample.blockers,
      ...sample.owners,
      ...sample.open_questions,
      ...sample.next_actions,
    ];
    for (const claim of claims) {
      const quotes = document.querySelectorAll(`[data-claim-id="${claim.id}"] blockquote`);
      expect(quotes.length, claim.text).toBe(claim.provenance === 'sourced' ? 1 : 0);
    }
    const question = row(sample.open_questions[0].id);
    expect(question.getByText(/^Likely still open: where should session state be stored/)).toBeInTheDocument();
    expect(question.getByText('Inferred')).toBeInTheDocument();
    expect(question.getByText('Raised 2 times, no answer')).toBeInTheDocument();
  });

  it('lists owners, ranked next actions and what each unblocks', () => {
    const view = card();
    expect(row(sample.owners[0].id).getByText('Priya Shah: Follow up with the customer on test credentials')).toBeInTheDocument();
    const actions = sample.next_actions.map((action) => row(action.id));
    expect(actions[0].getByText('1.')).toBeInTheDocument();
    expect(actions[2].getByText('3.')).toBeInTheDocument();
    expect(actions[2].getByText('Unblocks: Customer test credentials have not arrived')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'Evidence · 4 sources' })).toBeInTheDocument();
    expect(view.getByText(/· Pull request/)).toBeInTheDocument();
    expect(view.getByText(/· Transcript/)).toBeInTheDocument();
  });

  it('renders quotes and titles as text', () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const odd: WorkContextResponse = {
      ...sample,
      project: hostile,
      decisions: [{ ...sample.decisions[0], quote: hostile, display_text: hostile }],
    };
    render(<WorkContextCard result={odd} />);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getAllByText(hostile).length).toBeGreaterThanOrEqual(3);
  });
});

describe('Work Context screen', () => {
  const writeText = vi.fn();
  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  it('lists the pages captured by the extension and can clear them', async () => {
    render(<WorkContext />);
    expect(await screen.findByRole('heading', { name: 'Captured pages · 3' })).toBeInTheDocument();
    expect(screen.getByText('CAM-142 · Customer Authentication Migration')).toBeInTheDocument();
    expect(screen.getAllByText(/page text · [\d,]+ characters/)).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Clear captured pages' }));
    expect(await screen.findByRole('heading', { name: 'Captured pages · 0' })).toBeInTheDocument();
    expect(screen.getByText(/Right-click a page and choose/)).toBeInTheDocument();
  });

  it('reconstructs the project and shows it with quotes', async () => {
    render(<WorkContext />);
    await screen.findByRole('heading', { name: 'Captured pages · 3' });
    fireEvent.click(screen.getByRole('button', { name: 'Reconstruct' }));

    const card = within(await screen.findByRole('article', { name: 'Reconstructed project' }));
    expect(card.getByRole('heading', { name: 'Customer Authentication Migration' })).toBeInTheDocument();
    expect(card.getByText(/we'll go with Functions/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/Decided: Azure Functions for the token service/)).toBeInTheDocument();
  });

  it('cannot reconstruct with nothing to send, and can once text is pasted', async () => {
    render(<WorkContext />);
    await screen.findByRole('heading', { name: 'Captured pages · 3' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear captured pages' }));
    await screen.findByRole('heading', { name: 'Captured pages · 0' });
    expect(screen.getByRole('button', { name: 'Reconstruct' })).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Pasted text' }), {
      target: { value: 'Marcus: we will go with Functions.' },
    });
    expect(screen.getByText('34 of 12,000 characters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconstruct' })).toBeEnabled();
  });

  it('adds and removes files, and refuses one it cannot take', async () => {
    render(<WorkContext />);
    const input = screen.getByLabelText('Files to upload');

    fireEvent.change(input, { target: { files: [file('migration-doc.md', 2048)] } });
    expect(screen.getByText('migration-doc.md')).toBeInTheDocument();
    expect(screen.getByText('· 2 KB')).toBeInTheDocument();

    fireEvent.change(input, { target: { files: [file('deck.pptx')] } });
    expect(screen.getByRole('alert')).toHaveTextContent('deck.pptx is not a PDF, TXT, Markdown or VTT file');
    expect(screen.queryByText('deck.pptx')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove migration-doc.md' }));
    expect(screen.queryByText('migration-doc.md')).not.toBeInTheDocument();
  });

  it('copies the handoff brief', async () => {
    render(<WorkContext />);
    await screen.findByRole('heading', { name: 'Captured pages · 3' });
    fireEvent.click(screen.getByRole('button', { name: 'Reconstruct' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy handoff brief' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(sample.handoff_brief));
    expect(await screen.findByText('Handoff brief copied.')).toBeInTheDocument();
  });

  it('says so when the brief cannot be copied', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    render(<WorkContext />);
    await screen.findByRole('heading', { name: 'Captured pages · 3' });
    fireEvent.click(screen.getByRole('button', { name: 'Reconstruct' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy handoff brief' }));
    expect(await screen.findByText(/Could not copy/)).toBeInTheDocument();
  });

  it('saves the work context on this device, reopens it and deletes it', async () => {
    const { unmount } = render(<WorkContext />);
    await screen.findByRole('heading', { name: 'Captured pages · 3' });
    fireEvent.click(screen.getByRole('button', { name: 'Reconstruct' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save as work context' }));
    expect(screen.getByText('Saved on this device.')).toBeInTheDocument();
    expect(listSavedWorkContexts()).toHaveLength(1);
    unmount();

    render(<WorkContext />);
    expect(screen.getByRole('heading', { name: 'Saved work contexts · on this device' })).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Customer Authentication Migration' }));
    expect(screen.getByRole('article', { name: 'Reconstructed project' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Customer Authentication Migration' }));
    expect(screen.queryByRole('heading', { name: /Saved work contexts/ })).not.toBeInTheDocument();
    expect(listSavedWorkContexts()).toEqual([]);
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

    it('sends captured pages and the paste to analyze', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => sample });
      render(<WorkContext />);
      await screen.findByRole('heading', { name: 'Captured pages · 3' });
      fireEvent.change(screen.getByRole('textbox', { name: 'Title of the pasted text' }), {
        target: { value: contractItems[3].title },
      });
      fireEvent.change(screen.getByRole('textbox', { name: 'Pasted text' }), {
        target: { value: contractItems[3].text },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Reconstruct' }));

      await screen.findByRole('article', { name: 'Reconstructed project' });
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url).endsWith('/api/work-context/analyze')).toBe(true);
      // The same four items as the contract's request, in the same order.
      expect(JSON.parse(init.body)).toEqual(analyzeExample.request.body);
    });

    it('sends files to upload with the other items in items_json', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => sample });
      render(<WorkContext />);
      await screen.findByRole('heading', { name: 'Captured pages · 3' });
      fireEvent.change(screen.getByLabelText('Files to upload'), {
        target: { files: [file('migration-doc.md')] },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Reconstruct' }));

      await screen.findByRole('article', { name: 'Reconstructed project' });
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url).endsWith('/api/work-context/upload')).toBe(true);
      const form = init.body as FormData;
      expect((form.get('files[]') as File).name).toBe('migration-doc.md');
      expect(JSON.parse(form.get('items_json') as string)).toHaveLength(3);
    });

    it("shows the server's refusal, and labels a sample when the service is unreachable", async () => {
      const tooLarge = workContextContract.examples[1].response;
      fetchMock.mockResolvedValueOnce({ ok: false, status: 413, json: async () => tooLarge.body });
      render(<WorkContext />);
      await screen.findByRole('heading', { name: 'Captured pages · 3' });
      fireEvent.click(screen.getByRole('button', { name: 'Reconstruct' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('the limit is 5 MB per file');
      expect(screen.queryByRole('article')).not.toBeInTheDocument();

      fetchMock.mockRejectedValueOnce(new Error('offline'));
      fireEvent.click(screen.getByRole('button', { name: 'Reconstruct' }));
      await screen.findByRole('article', { name: 'Reconstructed project' });
      expect(screen.getByRole('alert')).toHaveTextContent('This is a sample result, not built from your items.');
    });
  });
});

describe('Work Context in the app', () => {
  it('opens from the left rail', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Work Context' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Work Context' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Captured pages · 3' })).toBeInTheDocument();
  });
});
