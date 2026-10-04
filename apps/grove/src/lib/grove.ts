import type { GroveResponse } from '../types';

export function countOpenQuestions(grove: GroveResponse | null): number {
  if (!grove) return 0;
  return grove.trees.reduce(
    (total, tree) => total + tree.unresolved_questions.filter((q) => q.status === 'open').length,
    0
  );
}

/** Every tab the grove shows: on trees, as sprouts, in the meadow and in the fog. */
export function countGroveTabs(grove: GroveResponse | null): number {
  if (!grove) return 0;
  return (
    grove.trees.reduce((sum, tree) => sum + tree.tabs.length, 0) +
    grove.sprouts.reduce((sum, sprout) => sum + sprout.tabs.length, 0) +
    grove.meadow.tabs.length +
    (grove.fog?.length ?? 0)
  );
}
