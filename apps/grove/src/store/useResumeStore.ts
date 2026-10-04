import { create } from 'zustand';
import type { ResumeResult } from '../adapters/contexts';

interface ResumeStoreState {
  /** The context being resumed: its card is pinned at the top of the grove. */
  resume: ResumeResult | null;
  setResume: (resume: ResumeResult | null) => void;
}

export const useResumeStore = create<ResumeStoreState>((set) => ({
  resume: null,
  setResume: (resume) => set({ resume }),
}));
