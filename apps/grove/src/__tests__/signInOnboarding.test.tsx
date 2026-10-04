import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import meContract from '@contracts/me.example.json';
import { App } from '../App';
import { resetMockBridge, sendBridgeMessage } from '../adapters/bridge';
import { forgetStandInAccount, getAccount, resetAccountStandIn } from '../adapters/me';
import { deleteAccount } from '../adapters/privacy';
import { countGroveTabs } from '../lib/grove';
import { loadLastGrove, saveLastGrove, clearLastGrove } from '../lib/lastGrove';
import { mockGroveResponse } from '../mocks/mockData';
import { CurrentGrove } from '../screens/CurrentGrove';
import { GroveOutline } from '../screens/GroveOutline';
import { ONBOARDING_STEPS, Onboarding } from '../screens/Onboarding';
import { PRIVACY_PROMISE, SignIn } from '../screens/SignIn';
import { useBridgeStore } from '../store/useBridgeStore';
import { useGroveStore } from '../store/useGroveStore';
import { GroveCanvas } from '../viz/GroveCanvas';
import { computeGroveLayout } from '../viz/layout';
import type { GroveResponse } from '../types';

// The real bridge, wrapped so tests can see which messages were sent.
vi.mock('../adapters/bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../adapters/bridge')>();
  return { ...actual, sendBridgeMessage: vi.fn(actual.sendBridgeMessage) };
});
const bridge = vi.mocked(sendBridgeMessage);
const sent = (type: string) => bridge.mock.calls.filter(([t]) => t === type).map(([, payload]) => payload);

const meExample = (name: string) =>
  meContract.examples.find((item) => item.name === name)!.response.body as {
    user: { id: string; display_name: string; email: string };
    first_sign_in: boolean;
  };

const resetAll = () => {
  resetMockBridge();
  resetAccountStandIn();
  clearLastGrove();
  bridge.mockClear();
  useGroveStore.setState({
    grove: mockGroveResponse,
    activeScreen: 'grove',
    isStreaming: false,
    groveNotice: null,
  });
  useBridgeStore.setState({ authState: { signed_in: true }, authChecked: false });
};

/** What a grow returns when only three tabs are open: sprouts and no tree (SPEC §13). */
const threeTabs: GroveResponse = {
  ...mockGroveResponse,
  trees: [],
  sprouts: [
    {
      sprout_ref: 'sprout-1',
      label: 'rust · cli',
      tab_count: 3,
      tabs: mockGroveResponse.trees[0].tabs.slice(0, 3),
    },
  ],
  meadow: { label: 'Wildflower Meadow', tabs: [] },
  fog: [],
  past_connections: [],
};

const shell = () => screen.queryByRole('navigation', { name: 'Primary' });

beforeEach(resetAll);

describe('GET /api/me adapter', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('stand-in: a known user is not on a first run', async () => {
    const later = meExample('later_call');
    expect(await getAccount()).toEqual({
      id: later.user.id,
      display_name: later.user.display_name,
      email: later.user.email,
      first_sign_in: false,
    });
  });

  it('stand-in: the first call for a new account says first_sign_in, later calls do not', async () => {
    forgetStandInAccount();
    expect((await getAccount())?.first_sign_in).toBe(true);
    expect((await getAccount())?.first_sign_in).toBe(false);
  });

  it('stand-in: "Delete all" removes the account, so the next sign-in is a first run', async () => {
    expect((await deleteAccount()).ok).toBe(true);
    expect((await getAccount())?.first_sign_in).toBe(true);
  });

  it('live: calls GET /api/me with the bridge token and reads the contract body', async () => {
    vi.stubEnv('VITE_MOCK', '0');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => meExample('first_call_provisions'),
    });
    vi.stubGlobal('fetch', fetchMock);

    const account = await getAccount();
    expect(account?.first_sign_in).toBe(true);
    expect(account?.display_name).toBe('Demo User');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url).endsWith('/api/me')).toBe(true);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toMatch(/^Bearer /);
    // user_id comes from the token; the request carries no body.
    expect(init.body).toBeUndefined();
  });

  it('live: a failed call is not treated as a first run', async () => {
    vi.stubEnv('VITE_MOCK', '0');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    expect(await getAccount()).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await getAccount()).toBeNull();
  });
});

describe('Sign-in screen', () => {
  it('offers Microsoft sign-in and the three-line privacy promise', () => {
    render(<SignIn onSignIn={async () => true} />);
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeInTheDocument();
    expect(PRIVACY_PROMISE).toHaveLength(3);
    const promise = within(screen.getByRole('list'));
    expect(promise.getAllByRole('listitem').map((item) => item.textContent)).toEqual([...PRIVACY_PROMISE]);
  });

  it('puts the keyboard on the sign-in button', () => {
    render(<SignIn onSignIn={async () => true} />);
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toHaveFocus();
  });

  it('says so when sign-in does not finish, and lets the user try again', async () => {
    const onSignIn = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<SignIn onSignIn={onSignIn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in did not finish');

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(onSignIn).toHaveBeenCalledTimes(2);
  });
});

describe('Onboarding', () => {
  it('has three steps, walked with Next and Back, and ends with the grove', () => {
    const onDone = vi.fn();
    render(<Onboarding name="Demo" onDone={onDone} />);
    expect(ONBOARDING_STEPS).toHaveLength(3);

    expect(screen.getByText(/Welcome, Demo\. Step 1 of 3/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: ONBOARDING_STEPS[0].title })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/Step 2 of 3/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: ONBOARDING_STEPS[1].title })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText(/Step 1 of 3/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { level: 1, name: ONBOARDING_STEPS[2].title })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Open my grove' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('can be skipped', () => {
    const onDone = vi.fn();
    render(<Onboarding onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('Signing in and out in the app', () => {
  it('learns from the extension whether the user is signed in', async () => {
    expect(useBridgeStore.getState().authChecked).toBe(false);
    await useBridgeStore.getState().initializeBridge();
    expect(useBridgeStore.getState().authChecked).toBe(true);
    expect(await useBridgeStore.getState().signIn()).toBe(true);
  });

  it('shows only the sign-in screen to a signed-out user, then the grove after sign-in', async () => {
    await sendBridgeMessage('SIGN_OUT');
    render(<App />);

    expect(await screen.findByRole('button', { name: 'Sign in with Microsoft' })).toBeInTheDocument();
    expect(shell()).toBeNull();
    // No grove content is on the page before sign-in.
    expect(screen.queryByText(mockGroveResponse.trees[0].project.name)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Current Grove' })).toBeInTheDocument();
    expect(sent('SIGN_IN')).toHaveLength(1);
    // A known account goes straight in; onboarding is for the first sign-in only.
    expect(screen.queryByText(/Step 1 of 3/)).not.toBeInTheDocument();
  });

  it('signs out from the left rail and leaves nothing of the grove behind', async () => {
    saveLastGrove(mockGroveResponse);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('button', { name: 'Sign in with Microsoft' })).toBeInTheDocument();
    expect(sent('SIGN_OUT')).toHaveLength(1);
    expect(useGroveStore.getState().grove).toBeNull();
    expect(loadLastGrove()).toBeNull();
  });

  it('walks a first-time user through onboarding before the grove', async () => {
    forgetStandInAccount();
    await sendBridgeMessage('SIGN_OUT');
    // Signed out from another screen, as "Delete all" on Privacy does.
    useGroveStore.setState({ activeScreen: 'privacy' });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Microsoft' }));

    expect(await screen.findByText(/Step 1 of 3/)).toBeInTheDocument();
    expect(shell()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open my grove' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Current Grove' })).toBeInTheDocument();
    expect(shell()).not.toBeNull();
  });

  it('does not show onboarding to a returning user who is already signed in', async () => {
    render(<App />);
    await waitFor(() => expect(useBridgeStore.getState().authChecked).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/Step 1 of 3/)).not.toBeInTheDocument();
    expect(shell()).not.toBeNull();
  });
});

describe('Only 2–3 tabs open', () => {
  const show = (grove: GroveResponse | null) =>
    render(<CurrentGrove grove={grove} onShowEvidence={() => {}} />);

  it('counts every tab the grove shows', () => {
    expect(countGroveTabs(null)).toBe(0);
    expect(countGroveTabs(threeTabs)).toBe(3);
    expect(countGroveTabs(mockGroveResponse)).toBe(
      mockGroveResponse.trees.reduce((sum, tree) => sum + tree.tabs.length, 0) +
        mockGroveResponse.sprouts.reduce((sum, sprout) => sum + sprout.tabs.length, 0) +
        mockGroveResponse.meadow.tabs.length +
        (mockGroveResponse.fog?.length ?? 0)
    );
  });

  it('says TabForest learns as you browse and still shows the tabs as sprouts', () => {
    const { container } = show(threeTabs);
    const note = screen.getByRole('status');
    expect(note).toHaveTextContent('TabForest learns as you browse');
    expect(note).toHaveTextContent('With only 3 tabs open');
    expect(screen.queryByText('No grove yet.')).not.toBeInTheDocument();

    expect(container.querySelectorAll('[data-kind="tree"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-kind="sprout"] [data-kind="leaf"]')).toHaveLength(3);
  });

  it('lists the same sprouts in the Outline', () => {
    show(threeTabs);
    fireEvent.click(screen.getByRole('button', { name: 'Outline' }));
    expect(screen.getByRole('heading', { level: 2, name: 'rust · cli' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('TabForest learns as you browse');
  });

  it('does not say so for a full grove, or while one is growing', () => {
    const { unmount } = show(mockGroveResponse);
    expect(screen.queryByText('TabForest learns as you browse')).not.toBeInTheDocument();
    unmount();

    useGroveStore.setState({ isStreaming: true });
    show(threeTabs);
    expect(screen.queryByText('TabForest learns as you browse')).not.toBeInTheDocument();
  });

  it('keeps the plain empty state when there is no grove at all', () => {
    show(null);
    expect(screen.getByText('No grove yet.')).toBeInTheDocument();
    expect(screen.queryByText('TabForest learns as you browse')).not.toBeInTheDocument();
  });
});

describe('Keyboard focus order on the canvas', () => {
  it('goes through sprouts, trees, meadow and fog from left to right', () => {
    const { container } = render(<GroveCanvas grove={mockGroveResponse} />);
    const layout = computeGroveLayout(mockGroveResponse);
    const stops = [...container.querySelectorAll<SVGGElement>('svg [tabindex="0"]')];

    const expected = [
      ...layout.sprouts.map((sprout) => ({ x: sprout.x, kind: 'sprout' })),
      ...layout.trees.map((tree) => ({ x: tree.x, kind: 'tree' })),
      ...(layout.meadow ? [{ x: layout.meadow.x, kind: 'meadow' }] : []),
      ...(layout.fog ? [{ x: layout.fog.x, kind: 'fog' }] : []),
    ];
    expect(stops.map((stop) => stop.getAttribute('data-kind'))).toEqual(expected.map((e) => e.kind));
    // Document order is the tab order, and it matches the positions on screen.
    const xs = expected.map((e) => e.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));

    for (const stop of stops) {
      expect(stop.getAttribute('role')).toBe('button');
      expect(stop.getAttribute('aria-label')).toBeTruthy();
    }
    expect(stops[layout.sprouts.length].getAttribute('aria-label')).toContain(layout.trees[0].name);
  });

  it('opens Tree Detail with Enter or Space on a focused tree', async () => {
    const { container } = render(<App />);
    const trees = container.querySelectorAll<SVGGElement>('[data-kind="tree"]');

    fireEvent.keyDown(trees[0], { key: 'Enter' });
    let drawer = screen.getByRole('complementary', { name: 'Tree detail' });
    expect(
      within(drawer).getByRole('heading', { name: mockGroveResponse.trees[0].project.name })
    ).toBeInTheDocument();

    fireEvent.keyDown(trees[1], { key: ' ' });
    drawer = screen.getByRole('complementary', { name: 'Tree detail' });
    expect(
      within(drawer).getByRole('heading', { name: mockGroveResponse.trees[1].project.name })
    ).toBeInTheDocument();
  });

  it('ignores other keys', () => {
    const { container } = render(<App />);
    fireEvent.keyDown(container.querySelector('[data-kind="tree"]') as Element, { key: 'a' });
    expect(screen.queryByRole('complementary', { name: 'Tree detail' })).not.toBeInTheDocument();
  });
});

describe('Outline view: the same grove as a nested list', () => {
  const outline = (grove: GroveResponse, onOpenTab?: (ref: string) => void) =>
    render(<GroveOutline grove={grove} onShowEvidence={() => {}} onOpenTab={onOpenTab} />);

  it('nests every tab under its path, under its goal', () => {
    outline(mockGroveResponse, () => {});
    for (const tree of mockGroveResponse.trees) {
      const item = screen.getByRole('heading', { level: 2, name: tree.project.name }).closest('li')!;
      for (const branch of tree.branches) {
        if (branch.label) expect(within(item).getByText(branch.label)).toBeInTheDocument();
      }
      expect(within(item).getAllByRole('button', { name: tree.tabs[0].title }).length).toBeGreaterThan(0);
    }
  });

  it('includes sprouts, the meadow and the unclear tabs with their reason', () => {
    outline(mockGroveResponse);
    const sprout = mockGroveResponse.sprouts[0];
    expect(screen.getByRole('heading', { level: 2, name: sprout.label })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: mockGroveResponse.meadow.label })).toBeInTheDocument();

    const unclear = screen.getByRole('heading', { level: 2, name: 'Unclear' }).closest('section')!;
    const fog = mockGroveResponse.fog![0];
    expect(within(unclear).getByText(fog.tab.title)).toBeInTheDocument();
    expect(unclear).toHaveTextContent(fog.reason);
  });

  it('opens a tab from the list', () => {
    const onOpenTab = vi.fn();
    outline(mockGroveResponse, onOpenTab);
    const tab = mockGroveResponse.meadow.tabs[0];
    fireEvent.click(screen.getByRole('button', { name: tab.title }));
    expect(onOpenTab).toHaveBeenCalledWith(tab.tab_ref);
  });

  it('opens a tab through the bridge from the Outline in the app', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Outline' }));
    const tab = mockGroveResponse.meadow.tabs[0];
    fireEvent.click(screen.getByRole('button', { name: tab.title }));
    expect(sent('OPEN_TAB')).toEqual([{ tab_ref: tab.tab_ref }]);
  });

  it('says a listening tree has no result yet instead of showing empty claims', () => {
    const [first, ...rest] = mockGroveResponse.trees;
    outline({ ...mockGroveResponse, trees: [{ ...first, pending: true }, ...rest] });
    const item = screen.getByRole('heading', { level: 2, name: first.project.name }).closest('li')!;
    expect(within(item).getByText(/Listening…/)).toBeInTheDocument();
    expect(within(item).queryByText('Goal')).not.toBeVisible();
  });

  it('writes page titles as text, never as markup', () => {
    const [first, ...rest] = mockGroveResponse.trees;
    const hostile = {
      ...first,
      tabs: first.tabs.map((tab, index) => (index === 0 ? { ...tab, title: '<img src=x onerror=alert(1)>' } : tab)),
    };
    const { container } = outline({ ...mockGroveResponse, trees: [hostile, ...rest] });
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });
});
