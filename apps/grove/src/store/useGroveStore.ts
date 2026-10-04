import { create } from 'zustand';
import { GroveResponse, GroveTab, TreeData, StreamMessage } from '../types';
import { loadLastGrove } from '../lib/lastGrove';

/** A cluster the server has grouped but not yet explained: a tree that is still listening. */
function pendingTree(cluster: {
  cluster_ref: string;
  project_name: string;
  tab_refs: string[];
  tabs?: GroveTab[];
}): TreeData {
  const tabs: GroveTab[] =
    cluster.tabs ??
    cluster.tab_refs.map((ref) => ({
      tab_ref: ref,
      title: 'Untitled tab',
      domain: '',
      dwell_minutes: 0,
      is_open: true,
    }));
  const empty = { text: '', display_text: '', provenance: 'hypothesis' as const, confidence: 0, evidence: [] };
  return {
    cluster_ref: cluster.cluster_ref,
    project: { id: cluster.cluster_ref, name: cluster.project_name, is_existing_project_id: null },
    status: 'active',
    attention_minutes: 0,
    last_active_at: new Date().toISOString(),
    goal: empty,
    branches: [
      {
        branch_ref: `${cluster.cluster_ref}:pending`,
        label: '',
        status: 'active',
        tab_refs: tabs.map((tab) => tab.tab_ref),
      },
    ],
    current_direction: empty,
    decisions: [],
    unresolved_questions: [],
    blockers: [],
    next_actions: [],
    redundant_groups: [],
    important_tab_refs: [],
    hypotheses: [],
    tabs,
    pending: true,
  };
}

export type ActiveScreen =
  | 'grove'
  | 'timeline'
  | 'saved'
  | 'work-context'
  | 'memory'
  | 'privacy';

interface GroveStoreState {
  grove: GroveResponse | null;
  selectedTreeId: string | null;
  selectedElement: {
    type: 'tree' | 'branch' | 'leaf' | 'mushroom' | 'stone' | 'sprout' | 'past_connection';
    id: string;
    data?: any;
  } | null;
  activeScreen: ActiveScreen;
  isStreaming: boolean;
  streamProgress: {
    clustersReceived: boolean;
    treesReceivedCount: number;
    totalTreesExpected: number;
  };
  highlightedEvidenceRefs: string[];
  /** Why the grove on screen is not a fresh, full one (offline, sample data, ...). */
  groveNotice: string | null;

  // Actions
  setGroveNotice: (notice: string | null) => void;
  setGrove: (grove: GroveResponse | null) => void;
  updateTreeInGrove: (tree: TreeData) => void;
  setSelectedTreeId: (id: string | null) => void;
  setSelectedElement: (element: GroveStoreState['selectedElement']) => void;
  setActiveScreen: (screen: ActiveScreen) => void;
  setStreaming: (isStreaming: boolean) => void;
  handleStreamMessage: (msg: StreamMessage) => void;
  setHighlightedEvidenceRefs: (refs: string[]) => void;
  clearHighlights: () => void;
}

export const useGroveStore = create<GroveStoreState>((set) => ({
  // The last finished grove opens instantly; a first grow replaces it.
  grove: loadLastGrove(),
  selectedTreeId: null,
  selectedElement: null,
  activeScreen: 'grove',
  isStreaming: false,
  streamProgress: {
    clustersReceived: false,
    treesReceivedCount: 0,
    totalTreesExpected: 0,
  },
  highlightedEvidenceRefs: [],
  groveNotice: null,

  setGroveNotice: (groveNotice) => set({ groveNotice }),

  setGrove: (grove) => set({ grove }),

  updateTreeInGrove: (tree) =>
    set((state) => {
      if (!state.grove) return state;
      const updatedTrees = state.grove.trees.map((t) =>
        t.cluster_ref === tree.cluster_ref || t.project.id === tree.project.id ? tree : t
      );
      return { grove: { ...state.grove, trees: updatedTrees } };
    }),

  setSelectedTreeId: (id) => set({ selectedTreeId: id }),

  setSelectedElement: (element) => set({ selectedElement: element }),

  setActiveScreen: (activeScreen) => set({ activeScreen }),

  setStreaming: (isStreaming) => set({ isStreaming }),

  handleStreamMessage: (msg) => {
    if (msg.type === 'clusters') {
      // Clustering is done: every goal gets its tree at once, still listening.
      set((state) => ({
        isStreaming: true,
        streamProgress: {
          clustersReceived: true,
          treesReceivedCount: 0,
          totalTreesExpected: msg.clusters.length,
        },
        grove: {
          schema_version: '1.0',
          run_id: msg.run_id ?? 'streaming-run',
          generated_at: new Date().toISOString(),
          degraded: false,
          hollow_count: msg.hollow_count ?? state.grove?.hollow_count ?? 0,
          trees: msg.clusters.map(pendingTree),
          meadow: msg.meadow ?? { label: 'Wildflower Meadow', tabs: [] },
          sprouts:
            msg.sprouts?.map((s) => ({
              sprout_ref: s.sprout_ref,
              label: s.label,
              tab_count: s.tab_count,
              tabs: s.tabs ?? [],
            })) || [],
          fog: msg.fog ?? [],
        },
      }));
    } else if (msg.type === 'tree') {
      set((state) => {
        if (!state.grove) return state;
        const { type: _type, ...tree } = msg;
        const matches = (t: TreeData) =>
          t.cluster_ref === tree.cluster_ref || t.project.id === tree.project.id;
        // A tree takes the place its cluster was given, so the forest does not reshuffle.
        const known = state.grove.trees.some(matches);
        const trees = known
          ? state.grove.trees.map((t) => (matches(t) ? tree : t))
          : [...state.grove.trees, tree];
        return {
          grove: { ...state.grove, trees },
          streamProgress: {
            ...state.streamProgress,
            treesReceivedCount: trees.filter((t) => !t.pending).length,
          },
        };
      });
    } else if (msg.type === 'done') {
      set((state) => ({
        isStreaming: false,
        grove: state.grove
          ? {
              ...state.grove,
              run_id: msg.run_id,
              degraded: msg.degraded,
              past_connections: msg.past_connections ?? state.grove.past_connections,
              // Nothing more is coming, so no tree is left waiting.
              trees: state.grove.trees.map((t) => (t.pending ? { ...t, pending: false } : t)),
            }
          : null,
      }));
    }
  },

  setHighlightedEvidenceRefs: (refs) => set({ highlightedEvidenceRefs: refs }),

  clearHighlights: () => set({ highlightedEvidenceRefs: [] }),
}));
