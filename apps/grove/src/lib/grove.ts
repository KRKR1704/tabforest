import type { GroveResponse } from '../types';

export function countOpenQuestions(grove: GroveResponse | null): number {
  if (!grove) return 0;
  return grove.trees.reduce(
    (total, tree) => total + tree.unresolved_questions.filter((q) => q.status === 'open').length,
    0
  );
}
