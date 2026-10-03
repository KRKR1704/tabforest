import { describe, it, expect } from 'vitest';
import { useGroveStore } from '../store/useGroveStore';
import { useBridgeStore } from '../store/useBridgeStore';

describe('Zustand Stores', () => {
  it('updates Grove state through store actions', () => {
    const store = useGroveStore.getState();
    expect(store.grove).toBeDefined();

    store.setSelectedTreeId('p-hackathon-prep');
    expect(useGroveStore.getState().selectedTreeId).toBe('p-hackathon-prep');

    store.setActiveScreen('timeline');
    expect(useGroveStore.getState().activeScreen).toBe('timeline');

    store.setHighlightedEvidenceRefs(['t1', 'q1']);
    expect(useGroveStore.getState().highlightedEvidenceRefs).toEqual(['t1', 'q1']);

    store.clearHighlights();
    expect(useGroveStore.getState().highlightedEvidenceRefs).toEqual([]);
  });

  it('handles streaming messages in Grove store', () => {
    const store = useGroveStore.getState();

    store.handleStreamMessage({
      type: 'clusters',
      clusters: [
        { cluster_ref: 'c1', project_name: 'Test Project', tab_refs: ['t1'] },
      ],
    });
    expect(useGroveStore.getState().isStreaming).toBe(true);
    expect(useGroveStore.getState().streamProgress.totalTreesExpected).toBe(1);

    store.handleStreamMessage({
      type: 'done',
      run_id: 'test-run-123',
      degraded: false,
    });
    expect(useGroveStore.getState().isStreaming).toBe(false);
  });

  it('updates Bridge store actions', async () => {
    const bridgeStore = useBridgeStore.getState();
    await bridgeStore.initializeBridge();

    expect(useBridgeStore.getState().hollowCount).toBe(3);
    expect(useBridgeStore.getState().authState.signed_in).toBe(true);

    await bridgeStore.signOut();
    expect(useBridgeStore.getState().authState.signed_in).toBe(false);

    await bridgeStore.signIn();
    expect(useBridgeStore.getState().authState.signed_in).toBe(true);
  });
});
