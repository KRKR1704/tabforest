import { create } from 'zustand';
import { GroveResponse, TreeData, StreamMessage } from '../types';
import { mockGroveResponse } from '../mocks/mockData';

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

  // Actions
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
  grove: mockGroveResponse,
  selectedTreeId: 'p-backend-auth',
  selectedElement: null,
  activeScreen: 'grove',
  isStreaming: false,
  streamProgress: {
    clustersReceived: false,
    treesReceivedCount: 0,
    totalTreesExpected: 0,
  },
  highlightedEvidenceRefs: [],

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
      set((state) => ({
        isStreaming: true,
        streamProgress: {
          clustersReceived: true,
          treesReceivedCount: 0,
          totalTreesExpected: msg.clusters.length,
        },
        grove: {
          schema_version: '1.0',
          run_id: 'streaming-run',
          generated_at: new Date().toISOString(),
          degraded: false,
          hollow_count: state.grove?.hollow_count || 0,
          trees: [],
          meadow: {
            label: 'Wildflower Meadow',
            tabs: [],
          },
          sprouts: msg.sprouts?.map((s) => ({
            sprout_ref: s.sprout_ref,
            label: s.label,
            tab_count: s.tab_count,
            age_minutes: 5,
            tabs: [],
          })) || [],
        },
      }));
    } else if (msg.type === 'tree') {
      set((state) => {
        if (!state.grove) return state;
        const currentTrees = state.grove.trees.filter(
          (t) => t.cluster_ref !== msg.cluster_ref && t.project.id !== msg.project.id
        );
        const newTrees = [...currentTrees, msg];
        return {
          grove: {
            ...state.grove,
            trees: newTrees,
          },
          streamProgress: {
            ...state.streamProgress,
            treesReceivedCount: newTrees.length,
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
            }
          : null,
      }));
    }
  },

  setHighlightedEvidenceRefs: (refs) => set({ highlightedEvidenceRefs: refs }),

  clearHighlights: () => set({ highlightedEvidenceRefs: [] }),
}));
