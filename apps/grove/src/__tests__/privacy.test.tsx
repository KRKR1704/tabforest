import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import meContract from '@contracts/me.example.json';
import privacyContract from '@contracts/privacy.example.json';
import { App } from '../App';
import { resetMockBridge, sendBridgeMessage } from '../adapters/bridge';
import {
  deleteAccount,
  deleteForest,
  getPrivacy,
  patchPrivacy,
  resetPrivacyStandIn,
  type PrivacySettings,
} from '../adapters/privacy';
import { loadLastGrove, saveLastGrove } from '../lib/lastGrove';
import {
  HOLLOW_CATEGORIES,
  PAUSED_UNTIL_RESUMED,
  describeCapture,
  isPaused,
  normalizeDomain,
  pauseUntil,
} from '../lib/privacy';
import { listSavedWorkContexts, saveWorkContext } from '../lib/savedWorkContexts';
import { SAMPLE_WORK_CONTEXT } from '../adapters/workContext';
import { Privacy } from '../screens/Privacy';
import { mockGroveResponse } from '../mocks/mockData';
import { useBridgeStore } from '../store/useBridgeStore';
import { useGroveStore } from '../store/useGroveStore';

// The real bridge, wrapped so tests can see which messages were sent.
vi.mock('../adapters/bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../adapters/bridge')>();
  return { ...actual, sendBridgeMessage: vi.fn(actual.sendBridgeMessage) };
});
const bridge = vi.mocked(sendBridgeMessage);
const sent = (type: string) => bridge.mock.calls.filter(([t]) => t === type).map(([, payload]) => payload);

const example = (contract: typeof privacyContract | typeof meContract, name: string) =>
  contract.examples.find((item) => item.name === name)!;
const defaults = example(privacyContract, 'get_defaults').response.body as unknown as PrivacySettings;
const deletedForest = example(privacyContract, 'delete_forest');
const deletedAccount = example(meContract, 'delete_account');
const auth = mockGroveResponse.trees[0];
const NOW = new Date('2026-10-04T11:51:00Z');

beforeEach(() => {
  resetPrivacyStandIn();
  resetMockBridge();
  bridge.mockClear();
  localStorage.clear();
  useGroveStore.setState({ grove: mockGroveResponse, activeScreen: 'grove', isStreaming: false });
  useBridgeStore.setState({ hollowCount: 3, sendPreview: null });
});

describe('privacy helpers', () => {
  it('works out when a pause ends', () => {
    expect(pauseUntil('hour', NOW)).toBe('2026-10-04T12:51:00.000Z');
    expect(pauseUntil('resumed', NOW)).toBe(PAUSED_UNTIL_RESUMED);

    const local = new Date(2026, 9, 4, 15, 30);
    const tomorrow = new Date(pauseUntil('tomorrow', local));
    expect([tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate()]).toEqual([2026, 9, 5]);
    expect([tomorrow.getHours(), tomorrow.getMinutes()]).toEqual([0, 0]);
  });

  it('knows whether capture is paused, and says so in words', () => {
    expect(isPaused(null, NOW)).toBe(false);
    expect(isPaused('2026-10-04T10:00:00Z', NOW)).toBe(false);
    expect(isPaused('2026-10-04T12:51:00Z', NOW)).toBe(true);

    expect(describeCapture(null, NOW, 'UTC')).toBe('Capturing');
    expect(describeCapture('2026-10-04T10:00:00Z', NOW, 'UTC')).toBe('Capturing');
    expect(describeCapture('2026-10-04T12:51:00Z', NOW, 'UTC')).toBe('Paused until Today, 12:51 PM');
    expect(describeCapture(PAUSED_UNTIL_RESUMED, NOW, 'UTC')).toBe('Paused until you resume');
  });

  it('turns what was typed into a bare lowercase domain, or rejects it', () => {
    expect(normalizeDomain('mybank.com')).toBe('mybank.com');
    expect(normalizeDomain('  HTTPS://www.MyBank.com/login?next=1#top ')).toBe('www.mybank.com');
    expect(normalizeDomain('*.mybank.com')).toBe('mybank.com');
    expect(normalizeDomain('portal.health.example.org:8443/path')).toBe('portal.health.example.org');
    for (const bad of ['', 'not a domain', 'localhost', 'mybank', 'http://', 'bank..com', '-x.com']) {
      expect(normalizeDomain(bad), bad).toBeNull();
    }
  });
});

describe('privacy adapter (C7): stand-in', () => {
  it('starts from the contract defaults and applies only what a patch sends', async () => {
    expect(await getPrivacy()).toEqual({ ok: true, value: defaults });

    const patched = await patchPrivacy({ excluded_domains_add: ['mybank.com'], retention_days: 30 });
    expect(patched.ok && patched.value).toMatchObject({
      excluded_domains: ['mybank.com'],
      retention_days: 30,
      paused_until: null,
      cloud_ai_enabled: true,
    });

    const again = await patchPrivacy({ excluded_domains_add: ['mybank.com'] });
    expect(again.ok && again.value.excluded_domains).toEqual(['mybank.com']);
    const removed = await patchPrivacy({ excluded_domains_remove: ['mybank.com'] });
    expect(removed.ok && removed.value.excluded_domains).toEqual([]);
    expect(removed.ok && removed.value.retention_days).toBe(30);
  });

  it('reports the contract counts for a deleted forest and a deleted account', async () => {
    const forest = await deleteForest(auth.cluster_ref);
    expect(forest.ok && forest.value.total).toBe(30);
    const account = await deleteAccount();
    expect(account.ok && account.value.total).toBe(830);
  });
});

describe('privacy adapter (C7): live', () => {
  const fetchMock = vi.fn();
  const reply = (body: unknown, status = 200) =>
    fetchMock.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body });
  const lastCall = () => {
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    return { url: String(url), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
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

  it('reads the settings with GET /api/privacy', async () => {
    reply(defaults);
    expect(await getPrivacy()).toEqual({ ok: true, value: defaults });
    const call = lastCall();
    expect(call.url.endsWith('/api/privacy')).toBe(true);
    expect(call.method).toBe('GET');
    expect(call.headers.Authorization).toMatch(/^Bearer /);
  });

  it.each([
    ['patch_exclude_and_retention'],
    ['patch_pause_one_hour'],
    ['patch_pause_until_resumed'],
    ['patch_resume'],
    ['patch_remove_exclusion'],
  ])('sends the contract request for %s', async (name) => {
    const contract = example(privacyContract, name);
    reply(contract.response.body);
    const outcome = await patchPrivacy(contract.request.body as never);
    const call = lastCall();
    expect(call.method).toBe('PATCH');
    expect(call.url.endsWith('/api/privacy')).toBe(true);
    expect(call.body).toEqual(contract.request.body);
    expect(JSON.stringify(call.body)).not.toContain('user_id');
    expect(outcome).toEqual({ ok: true, value: contract.response.body });
  });

  it("returns the server's own words when it refuses a change", async () => {
    const contract = example(privacyContract, 'reject_retention_value');
    reply(contract.response.body, 422);
    expect(await patchPrivacy({ retention_days: 45 as never })).toEqual({
      ok: false,
      message: 'retention_days must be 7, 30 or 90',
    });
  });

  it('deletes a forest and an account with the contract requests', async () => {
    reply(deletedForest.response.body);
    const forest = await deleteForest(auth.cluster_ref);
    expect(lastCall().method).toBe('DELETE');
    expect(lastCall().url.endsWith(deletedForest.request.path)).toBe(true);
    expect(lastCall().body).toBeUndefined();
    expect(forest.ok && forest.value.total).toBe(30);

    reply(deletedAccount.response.body);
    const account = await deleteAccount();
    expect(lastCall().method).toBe('DELETE');
    expect(lastCall().url.endsWith('/api/me')).toBe(true);
    expect(account.ok && account.value.deleted.browser_events).toBe(651);
  });

  it('never pretends: a failed call is reported, not replaced by stand-in data', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const unreachable = { ok: false, message: 'The server could not be reached.' };
    expect(await getPrivacy()).toEqual(unreachable);
    expect(await patchPrivacy({ retention_days: 7 })).toEqual(unreachable);
    expect(await deleteForest('p')).toEqual(unreachable);
    expect(await deleteAccount()).toEqual(unreachable);
  });
});

describe('Privacy screen', () => {
  const section = (name: string) => within(screen.getByRole('region', { name }));
  const ready = () => screen.findByText('Capturing');

  it('shows capture status, the Hollow, retention and the delete controls', async () => {
    render(<Privacy />);
    await ready();
    expect(section('The Hollow').getByText(/3 tabs are resting in the Hollow\./)).toBeInTheDocument();
    for (const category of HOLLOW_CATEGORIES) {
      expect(section('The Hollow').getByText(category.name)).toBeInTheDocument();
    }
    expect(section('Retention').getByRole('radio', { name: '90 days' })).toBeChecked();
    expect(section('Delete').getAllByRole('button', { name: /^Delete forest / })).toHaveLength(4);
  });

  it('pauses for an hour through the bridge, then resumes', async () => {
    render(<Privacy />);
    await ready();
    const before = Date.now();
    fireEvent.click(screen.getByRole('button', { name: 'Pause for 1 hour' }));

    expect(await screen.findByText(/^Paused until Today,|^Paused until /)).toBeInTheDocument();
    const [{ until }] = sent('PAUSE') as Array<{ until: string }>;
    const end = Date.parse(until);
    expect(end).toBeGreaterThanOrEqual(before + 60 * 60 * 1000);
    expect(end).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000);
    expect(screen.queryByRole('button', { name: 'Pause for 1 hour' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resume capture' }));
    expect(await screen.findByText('Capturing')).toBeInTheDocument();
    expect(sent('PAUSE')[1]).toEqual({ until: null });
  });

  it('pauses until tomorrow, or until resumed', async () => {
    render(<Privacy />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Pause until I resume' }));
    expect(await screen.findByText('Paused until you resume')).toBeInTheDocument();
    expect(sent('PAUSE')[0]).toEqual({ until: PAUSED_UNTIL_RESUMED });

    fireEvent.click(screen.getByRole('button', { name: 'Resume capture' }));
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Pause until tomorrow' }));
    await waitFor(() => expect(sent('PAUSE')).toHaveLength(3));
    const until = new Date((sent('PAUSE')[2] as { until: string }).until);
    expect([until.getHours(), until.getMinutes()]).toEqual([0, 0]);
    expect(until.getTime()).toBeGreaterThan(Date.now());
  });

  it('excludes a site through the bridge and lists it', async () => {
    render(<Privacy />);
    await ready();
    const excluded = section('Never analyze these sites');
    fireEvent.change(excluded.getByRole('textbox', { name: 'Site to exclude' }), {
      target: { value: 'https://MyBank.com/login' },
    });
    fireEvent.click(excluded.getByRole('button', { name: 'Exclude site' }));

    expect(await screen.findByText('mybank.com will no longer be analyzed.')).toBeInTheDocument();
    expect(sent('EXCLUDE_DOMAIN')).toEqual([{ domain: 'mybank.com' }]);
    expect(within(excluded.getByRole('list', { name: 'Excluded sites' })).getByText('mybank.com')).toBeInTheDocument();
    expect(excluded.getByRole('textbox', { name: 'Site to exclude' })).toHaveValue('');
  });

  it('refuses something that is not a site, without telling the extension', async () => {
    render(<Privacy />);
    await ready();
    const excluded = section('Never analyze these sites');
    fireEvent.change(excluded.getByRole('textbox', { name: 'Site to exclude' }), {
      target: { value: 'my bank' },
    });
    fireEvent.click(excluded.getByRole('button', { name: 'Exclude site' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a site like mybank.com.');
    expect(sent('EXCLUDE_DOMAIN')).toEqual([]);
  });

  it('removes an exclusion', async () => {
    await patchPrivacy({ excluded_domains_add: ['mybank.com'] });
    render(<Privacy />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Stop excluding mybank.com' }));
    expect(await screen.findByText('mybank.com can be analyzed again.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Excluded sites' })).not.toBeInTheDocument();
  });

  it('changes retention', async () => {
    render(<Privacy />);
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: '7 days' }));
    expect(await screen.findByText('Your browsing memory is now kept for 7 days.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '7 days' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '90 days' })).not.toBeChecked();
  });

  it('shows what will be sent next, and keeps it live', async () => {
    render(<Privacy previewIntervalMs={20} />);
    const preview = section('What we send');
    expect(await preview.findByText(/5 events waiting in the next batch\./)).toBeInTheDocument();
    expect(preview.getByText(/No page text, and no full address\./)).toBeInTheDocument();
    const rows = preview.getAllByRole('row');
    expect(rows).toHaveLength(3); // header + two sample events
    expect(within(rows[1]).getByText('FOCUS')).toBeInTheDocument();
    expect(within(rows[1]).getByText('fastapi.tiangolo.com')).toBeInTheDocument();

    await waitFor(() => expect(sent('GET_SEND_PREVIEW').length).toBeGreaterThanOrEqual(3));
    const before = sent('GET_SEND_PREVIEW').length;
    fireEvent.click(preview.getByRole('button', { name: 'Refresh' }));
    expect(sent('GET_SEND_PREVIEW').length).toBeGreaterThan(before);
  });

  it('stops refreshing the preview when the screen closes', async () => {
    const { unmount } = render(<Privacy previewIntervalMs={10} />);
    await waitFor(() => expect(sent('GET_SEND_PREVIEW').length).toBeGreaterThanOrEqual(2));
    unmount();
    const count = sent('GET_SEND_PREVIEW').length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(sent('GET_SEND_PREVIEW')).toHaveLength(count);
  });

  it('deletes one forest only after it is confirmed', async () => {
    render(<Privacy />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: `Delete forest ${auth.project.name}` }));
    expect(screen.getByText(`Delete ${auth.project.name} and everything derived from it?`)).toBeInTheDocument();
    expect(useGroveStore.getState().grove?.trees).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useGroveStore.getState().grove?.trees).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: `Delete forest ${auth.project.name}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(
      await screen.findByText(`${auth.project.name} was deleted: 30 rows removed.`)
    ).toBeInTheDocument();
    expect(useGroveStore.getState().grove?.trees.map((tree) => tree.cluster_ref)).not.toContain(
      auth.cluster_ref
    );
    expect(sent('WIPE_LOCAL')).toEqual([]);
  });

  it('asks before deleting everything, and Cancel does nothing', async () => {
    render(<Privacy />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Delete all my memory' }));
    const dialog = within(screen.getByRole('alertdialog', { name: 'Delete all your memory?' }));
    expect(dialog.getByText(/It cannot be undone\./)).toBeInTheDocument();

    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(sent('WIPE_LOCAL')).toEqual([]);
    expect(useGroveStore.getState().grove).not.toBeNull();
  });

  it('deletes everything: the server first, then this device', async () => {
    saveLastGrove(mockGroveResponse);
    saveWorkContext(SAMPLE_WORK_CONTEXT);
    render(<Privacy />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Delete all my memory' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }));

    expect(
      await screen.findByText('Everything was deleted: 830 rows on the server, and all data on this device.')
    ).toBeInTheDocument();
    expect(sent('WIPE_LOCAL')).toHaveLength(1);
    expect(useGroveStore.getState().grove).toBeNull();
    expect(loadLastGrove()).toBeNull();
    expect(listSavedWorkContexts()).toEqual([]);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('There are no forests to delete.')).toBeInTheDocument();
  });
});

describe('Privacy screen: live requests', () => {
  const fetchMock = vi.fn();
  let failing: string[] = [];
  let server = { ...defaults, excluded_domains: ['mybank.com'] };
  const calls = () =>
    fetchMock.mock.calls.map(([url, init]) => ({
      route: `${init.method} ${String(url).replace(/^https?:\/\/[^/]+/, '')}`,
      body: init.body ? JSON.parse(init.body) : undefined,
    }));

  beforeEach(() => {
    failing = [];
    server = { ...defaults, excluded_domains: ['mybank.com'] };
    vi.stubEnv('VITE_MOCK', '0');
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockReset().mockImplementation(async (url: string, init: RequestInit) => {
      const route = `${init.method} ${String(url).replace(/^https?:\/\/[^/]+/, '')}`;
      if (failing.includes(route)) {
        return { ok: false, status: 503, json: async () => ({ detail: 'The database is unavailable' }) };
      }
      if (route === 'GET /api/privacy') return { ok: true, status: 200, json: async () => server };
      if (route === 'PATCH /api/privacy') {
        // A small stand-in for the server: it applies only what the patch sends.
        const body = JSON.parse(String(init.body));
        server = {
          ...server,
          retention_days: body.retention_days ?? server.retention_days,
          excluded_domains: server.excluded_domains.filter(
            (domain: string) => !(body.excluded_domains_remove ?? []).includes(domain)
          ),
        };
        return { ok: true, status: 200, json: async () => server };
      }
      if (route === 'DELETE /api/me') return { ok: true, status: 200, json: async () => deletedAccount.response.body };
      return { ok: true, status: 200, json: async () => deletedForest.response.body };
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends retention and exclusion removals to PATCH /api/privacy', async () => {
    render(<Privacy />);
    await screen.findByText('Capturing');
    fireEvent.click(screen.getByRole('radio', { name: '30 days' }));
    await screen.findByText('Your browsing memory is now kept for 30 days.');
    fireEvent.click(screen.getByRole('button', { name: 'Stop excluding mybank.com' }));
    await screen.findByText('mybank.com can be analyzed again.');

    expect(calls().filter((call) => call.route === 'PATCH /api/privacy').map((call) => call.body)).toEqual([
      { retention_days: 30 },
      { excluded_domains_remove: ['mybank.com'] },
    ]);
  });

  it('leaves pause and exclusion to the extension: no PATCH from the page', async () => {
    render(<Privacy />);
    await screen.findByText('Capturing');
    fireEvent.click(screen.getByRole('button', { name: 'Pause for 1 hour' }));
    await screen.findByText('Capture is paused.');
    fireEvent.change(screen.getByRole('textbox', { name: 'Site to exclude' }), { target: { value: 'health.example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Exclude site' }));
    await screen.findByText('health.example.org will no longer be analyzed.');

    expect(sent('PAUSE')).toHaveLength(1);
    expect(sent('EXCLUDE_DOMAIN')).toEqual([{ domain: 'health.example.org' }]);
    expect(calls().some((call) => call.route === 'PATCH /api/privacy')).toBe(false);
  });

  it('deletes a forest with DELETE /api/projects/{id}', async () => {
    render(<Privacy />);
    await screen.findByText('Capturing');
    fireEvent.click(screen.getByRole('button', { name: `Delete forest ${auth.project.name}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText(/was deleted: 30 rows removed\./);
    expect(calls().map((call) => call.route)).toContain(`DELETE /api/projects/${auth.cluster_ref}`);
  });

  it('deletes everything with DELETE /api/me, and only then sends WIPE_LOCAL', async () => {
    render(<Privacy />);
    await screen.findByText('Capturing');
    bridge.mockClear();
    let deletedWhenWiped = false;
    bridge.mockImplementation(async (type, payload) => {
      if (type === 'WIPE_LOCAL') {
        deletedWhenWiped = calls().some((call) => call.route === 'DELETE /api/me');
      }
      const actual = await vi.importActual<typeof import('../adapters/bridge')>('../adapters/bridge');
      return actual.sendBridgeMessage(type, payload) as never;
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete all my memory' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }));
    await screen.findByText(/Everything was deleted: 830 rows/);

    expect(sent('WIPE_LOCAL')).toHaveLength(1);
    expect(deletedWhenWiped).toBe(true);
  });

  it('wipes nothing on this device when the server delete fails', async () => {
    saveLastGrove(mockGroveResponse);
    failing = ['DELETE /api/me'];
    render(<Privacy />);
    await screen.findByText('Capturing');
    fireEvent.click(screen.getByRole('button', { name: 'Delete all my memory' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nothing was deleted. The database is unavailable'
    );
    expect(sent('WIPE_LOCAL')).toEqual([]);
    expect(useGroveStore.getState().grove).not.toBeNull();
    expect(loadLastGrove()).not.toBeNull();
  });

  it('keeps a forest when its delete fails', async () => {
    failing = [`DELETE /api/projects/${auth.cluster_ref}`];
    render(<Privacy />);
    await screen.findByText('Capturing');
    fireEvent.click(screen.getByRole('button', { name: `Delete forest ${auth.project.name}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `${auth.project.name} was not deleted. The database is unavailable`
    );
    expect(useGroveStore.getState().grove?.trees).toHaveLength(4);
  });

  it('says so when the settings cannot be loaded, and offers to try again', async () => {
    failing = ['GET /api/privacy'];
    render(<Privacy />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your privacy settings could not be loaded. The database is unavailable'
    );
    expect(screen.getByText('Capture status unknown')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '90 days' })).toBeDisabled();

    failing = [];
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Capturing')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Privacy in the app', () => {
  it('opens from the left rail', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Privacy' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy' })).toBeInTheDocument();
    expect(await screen.findByText('Capturing')).toBeInTheDocument();
  });
});
