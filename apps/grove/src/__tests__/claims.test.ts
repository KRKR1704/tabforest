import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import claimsContract from '@contracts/claims.example.json';
import {
  analyzeTree,
  assignTab,
  createNote,
  normalizeClaimResponse,
  normalizeNoteResponse,
  patchClaim,
  type WireClaimResponse,
  type WireNoteResponse,
} from '../adapters/claims';
import { sendBridgeMessage } from '../adapters/bridge';
import {
  addDecision,
  applyClaimUpdate,
  hypothesisId,
  moveTab,
  nameFogTab,
  replaceTree,
} from '../lib/groveEdits';
import { computeGroveLayout } from '../viz/layout';
import { mockGroveResponse } from '../mocks/mockData';

type Example = (typeof claimsContract.examples)[number];
const example = (name: string): Example => {
  const found = claimsContract.examples.find((e) => e.name.startsWith(name));
  if (!found) throw new Error(`no contract example named ${name}`);
  return found;
};

const grove = mockGroveResponse;
const [auth, prep, jobs] = grove.trees;
const mossy = auth.decisions.find((d) => d.stone_kind === 'mossy')!;
const question = auth.unresolved_questions[0];

describe('claims adapter: wire format (C4)', () => {
  it('reads a confirmed stone from the contract: stated and carved', () => {
    const update = normalizeClaimResponse(example('confirm').response.body as WireClaimResponse);
    expect(update).toMatchObject({
      id: mossy.id,
      dismissed: false,
      provenance: 'stated',
      confidence: 1,
      stone_kind: 'carved',
    });
    expect(update.evidence?.[0]).toEqual({
      ref: update.user_note_id,
      ref_kind: 'note',
      why: 'user confirmed this decision',
    });
  });

  it('reads a resolved mushroom without mistaking its kind for a stone kind', () => {
    const update = normalizeClaimResponse(example('resolve').response.body as WireClaimResponse);
    expect(update.status).toBe('resolved');
    expect(update.answer).toMatch(/HttpOnly/);
    expect(update.stone_kind).toBeUndefined();
  });

  it('reads a dismissal', () => {
    const update = normalizeClaimResponse(example('dismiss').response.body as WireClaimResponse);
    expect(update).toEqual({ id: update.id, dismissed: true });
  });

  it('reads the note response for clearing the fog', () => {
    const result = normalizeNoteResponse(example('Clear the fog').response.body as WireNoteResponse);
    expect(result.note.kind).toBe('goal');
    expect(result.claim.provenance).toBe('stated');
    expect(result.claim.evidence.map((e) => e.ref_kind)).toEqual(['note', 'tab']);
  });
});

describe('claims adapter: requests in live mode', () => {
  const fetchMock = vi.fn();
  const reply = (body: unknown, status = 200) =>
    fetchMock.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body });
  const lastCall = () => {
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    return {
      url: String(url),
      method: init.method as string,
      headers: init.headers as Record<string, string>,
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    };
  };

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

  it.each([
    ['confirm', { action: 'confirm' }],
    ['edit', { action: 'edit', text: 'Prototype a refresh-token flow with HttpOnly, Secure, SameSite=Strict cookies' }],
    ['dismiss', { action: 'dismiss' }],
    [
      'resolve',
      {
        action: 'resolve',
        answer:
          'Keep the refresh token in an HttpOnly, Secure, SameSite=Strict cookie; keep the access token in memory',
      },
    ],
  ] as const)('sends the contract request for %s', async (name, body) => {
    const contract = example(name);
    reply(contract.response.body);
    const id = contract.request.path.split('/').pop() ?? '';

    await patchClaim(id, body);

    const call = lastCall();
    expect(call.method).toBe('PATCH');
    expect(call.url.endsWith(contract.request.path)).toBe(true);
    expect(call.body).toEqual(contract.request.body);
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(call.headers.Authorization).toMatch(/^Bearer /);
  });

  it('sends the contract request to move a leaf to another tree', async () => {
    const contract = example('move a leaf to another existing tree');
    reply(contract.response.body);
    const tabRef = contract.request.path.split('/')[3];

    const result = await assignTab(tabRef, { project_id: auth.cluster_ref, branch_label: 'Sessions' });

    const call = lastCall();
    expect(call.method).toBe('POST');
    expect(call.url.endsWith(contract.request.path)).toBe(true);
    expect(call.body).toEqual(contract.request.body);
    expect(result.reanalyze_project_ids).toHaveLength(2);
    expect(result.pinned).toBe(true);
  });

  it('sends the contract request to move a leaf to a new tree', async () => {
    const contract = example('move a leaf to a new tree');
    reply(contract.response.body, 201);
    const tabRef = contract.request.path.split('/')[3];

    const result = await assignTab(tabRef, { new_project_name: 'Interview Practice' });

    expect(lastCall().body).toEqual(contract.request.body);
    expect(result.project_name).toBe('Interview Practice');
  });

  it('sends the contract request to clear the fog', async () => {
    const contract = example('Clear the fog');
    reply(contract.response.body, 201);

    const result = await createNote({
      kind: 'goal',
      tab_ref: grove.fog?.[0].tab.tab_ref,
      text: 'Use a Pomodoro timer for focused work blocks',
    });

    const call = lastCall();
    expect(call.method).toBe('POST');
    expect(call.url.endsWith('/api/notes')).toBe(true);
    expect(call.body).toEqual(contract.request.body);
    expect(result.project_id).toBe((contract.response.body as WireNoteResponse).project_id);
  });

  it('re-analyzes one project with an empty POST and reads back one tree', async () => {
    const contract = example('re-analyze one project');
    reply(contract.response.body);

    const tree = await analyzeTree(auth.cluster_ref);

    const call = lastCall();
    expect(call.method).toBe('POST');
    expect(call.url.endsWith(contract.request.path)).toBe(true);
    expect(call.body).toBeUndefined();
    expect(tree?.project.name).toBe(auth.project.name);
    expect(tree?.tabs.length).toBe(auth.tabs.length);
  });

  it('never puts a user_id in a request body', async () => {
    reply(example('confirm').response.body);
    reply(example('move a leaf to another existing tree').response.body);
    reply(example('Clear the fog').response.body);
    await patchClaim(mossy.id, { action: 'confirm' });
    await assignTab('t', { project_id: 'p' });
    await createNote({ kind: 'note', text: 'x', project_id: 'p' });
    for (const [, init] of fetchMock.mock.calls) {
      expect(String(init.body)).not.toContain('user_id');
    }
  });

  it('falls back to the stand-in when the API fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const update = await patchClaim(mossy.id, { action: 'confirm' });
    expect(update).toMatchObject({ id: mossy.id, provenance: 'stated', stone_kind: 'carved' });

    reply({}, 500);
    expect(await analyzeTree(auth.cluster_ref)).toBeNull();
  });
});

describe('claims adapter: mock mode', () => {
  it('answers without touching the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await patchClaim('x', { action: 'dismiss' })).toEqual({ id: 'x', dismissed: true });
    expect((await patchClaim('x', { action: 'edit', text: 'mine' })).display_text).toBe('mine');
    expect((await patchClaim('x', { action: 'resolve', answer: 'yes' })).status).toBe('resolved');
    expect((await assignTab('t', { new_project_name: 'New' })).project_name).toBe('New');
    expect((await createNote({ kind: 'goal', tab_ref: 't', text: 'Goal' })).claim.text).toBe('Goal');
    expect(await analyzeTree('p')).toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('extension bridge (C8)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends payload fields flat, next to the message type', async () => {
    const sendMessage = vi.fn((_message: unknown, callback: (res: unknown) => void) =>
      callback({ ok: true, data: {} })
    );
    vi.stubGlobal('chrome', { runtime: { id: 'ext', sendMessage } });

    await sendBridgeMessage('OPEN_TAB', { tab_ref: 'abc' });
    await sendBridgeMessage('EXCLUDE_DOMAIN', { domain: 'example.com' });
    await sendBridgeMessage('GET_TOKEN');

    expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([
      { type: 'OPEN_TAB', tab_ref: 'abc' },
      { type: 'EXCLUDE_DOMAIN', domain: 'example.com' },
      { type: 'GET_TOKEN' },
    ]);
  });
});

describe('grove edits', () => {
  it('confirming a mossy stone carves it and drops the "appears to" wording', () => {
    const next = applyClaimUpdate(grove, {
      id: mossy.id,
      dismissed: false,
      provenance: 'stated',
      confidence: 1,
    });
    const decision = next.trees[0].decisions.find((d) => d.id === mossy.id);
    expect(decision).toMatchObject({ provenance: 'stated', stone_kind: 'carved', confidence: 1 });
    expect(decision?.display_text).toBe(mossy.text);
    expect(computeGroveLayout(next).trees[0].stones.every((s) => s.kind === 'carved')).toBe(true);
    // The original grove is untouched.
    expect(auth.decisions.find((d) => d.id === mossy.id)?.provenance).toBe('inferred');
  });

  it('resolving a question turns its mushroom into a flower', () => {
    const next = applyClaimUpdate(grove, {
      id: question.id,
      dismissed: false,
      status: 'resolved',
      answer: 'In an HttpOnly cookie',
    });
    expect(next.trees[0].unresolved_questions[0]).toMatchObject({
      status: 'resolved',
      answer: 'In an HttpOnly cookie',
      question: question.question,
    });
    expect(computeGroveLayout(next).trees[0].mushrooms[0].resolved).toBe(true);
  });

  it('editing a next action keeps it an action with the new text', () => {
    const action = auth.next_actions[0];
    const next = applyClaimUpdate(grove, {
      id: action.id,
      dismissed: false,
      text: 'Try cookies first',
      display_text: 'Try cookies first',
      provenance: 'stated',
    });
    expect(next.trees[0].next_actions[0]).toMatchObject({
      action: 'Try cookies first',
      display_text: 'Try cookies first',
      provenance: 'stated',
    });
  });

  it('dismissing removes a decision, a question, an action or a hypothesis', () => {
    const ids = [
      mossy.id,
      question.id,
      auth.next_actions[0].id,
      hypothesisId(auth, auth.hypotheses[0], 0),
    ];
    const next = ids.reduce((g, id) => applyClaimUpdate(g, { id, dismissed: true }), grove);
    const tree = next.trees[0];
    expect(tree.decisions.some((d) => d.id === mossy.id)).toBe(false);
    expect(tree.unresolved_questions).toHaveLength(0);
    expect(tree.next_actions).toHaveLength(0);
    expect(tree.hypotheses).toHaveLength(0);
  });

  it('confirming a hypothesis turns it into a stated decision', () => {
    const id = hypothesisId(auth, auth.hypotheses[0], 0);
    const next = applyClaimUpdate(grove, { id, dismissed: false, provenance: 'stated', confidence: 1 });
    expect(next.trees[0].hypotheses).toHaveLength(0);
    expect(next.trees[0].decisions.find((d) => d.id === id)).toMatchObject({
      provenance: 'stated',
      stone_kind: 'carved',
      text: auth.hypotheses[0].text,
    });
  });

  it('adds a stated decision to one tree only', () => {
    const next = addDecision(grove, prep.cluster_ref, {
      id: 'dec_new',
      text: 'Submit to two tracks',
      display_text: 'Submit to two tracks',
      provenance: 'stated',
      confidence: 1,
      evidence: [],
    });
    expect(next.trees[1].decisions.map((d) => d.id)).toContain('dec_new');
    expect(next.trees[0].decisions).toEqual(auth.decisions);
  });

  it('moves a leaf to the named branch of another tree', () => {
    const tab = prep.tabs[0];
    const next = moveTab(grove, tab.tab_ref, prep.cluster_ref, {
      projectId: auth.cluster_ref,
      branchLabel: 'Sessions',
    });
    expect(next.trees[1].tabs.some((t) => t.tab_ref === tab.tab_ref)).toBe(false);
    expect(next.trees[1].branches.flatMap((b) => b.tab_refs)).not.toContain(tab.tab_ref);
    expect(next.trees[0].tabs.some((t) => t.tab_ref === tab.tab_ref)).toBe(true);
    expect(next.trees[0].branches.find((b) => b.label === 'Sessions')?.tab_refs).toContain(
      tab.tab_ref
    );
  });

  it('moves a leaf to a new tree with the goal the user named', () => {
    const tab = jobs.tabs[0];
    const next = moveTab(grove, tab.tab_ref, jobs.cluster_ref, {
      projectId: 'p_new',
      newProjectName: 'Interview Practice',
    });
    const planted = next.trees.find((t) => t.cluster_ref === 'p_new');
    expect(next.trees).toHaveLength(grove.trees.length + 1);
    expect(planted?.project.name).toBe('Interview Practice');
    expect(planted?.goal.provenance).toBe('stated');
    expect(planted?.tabs.map((t) => t.tab_ref)).toEqual([tab.tab_ref]);
    expect(computeGroveLayout(next).trees).toHaveLength(grove.trees.length + 1);
  });

  it('removes a tree whose last leaf was moved away', () => {
    const dinner = grove.trees[3];
    const next = dinner.tabs.reduce(
      (g, tab) => moveTab(g, tab.tab_ref, dinner.cluster_ref, { projectId: auth.cluster_ref }),
      grove
    );
    expect(next.trees.some((t) => t.cluster_ref === dinner.cluster_ref)).toBe(false);
    expect(next.trees[0].tabs).toHaveLength(auth.tabs.length + dinner.tabs.length);
  });

  it('ignores a move onto the same tree or of an unknown tab', () => {
    expect(moveTab(grove, auth.tabs[0].tab_ref, auth.cluster_ref, { projectId: auth.cluster_ref })).toBe(
      grove
    );
    expect(moveTab(grove, 'missing', auth.cluster_ref, { projectId: prep.cluster_ref })).toBe(grove);
  });

  it('clearing the fog gives the tab a tree of its own', () => {
    const fogTab = grove.fog![0].tab;
    const next = nameFogTab(grove, fogTab.tab_ref, 'p_fog', {
      id: 'g_new',
      text: 'Use a Pomodoro timer',
      display_text: 'Use a Pomodoro timer',
      provenance: 'stated',
      confidence: 1,
      evidence: [],
    });
    expect(next.fog).toHaveLength(0);
    const planted = next.trees[next.trees.length - 1];
    expect(planted.project.name).toBe('Use a Pomodoro timer');
    expect(planted.goal.id).toBe('g_new');
    expect(planted.tabs[0].tab_ref).toBe(fogTab.tab_ref);
    expect(computeGroveLayout(next).fog).toBeNull();
  });

  it('replaces a tree by id, or appends one that is new', () => {
    const renamed = { ...auth, project: { ...auth.project, name: 'Auth, re-analyzed' } };
    expect(replaceTree(grove, renamed).trees[0].project.name).toBe('Auth, re-analyzed');
    expect(replaceTree(grove, { ...auth, cluster_ref: 'p_other' }).trees).toHaveLength(
      grove.trees.length + 1
    );
  });
});
