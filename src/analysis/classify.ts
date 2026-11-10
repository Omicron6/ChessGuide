import type { Score } from '../engine/engine';

export type Grade = 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

/** Win-probability loss (percentage points) below which a move gets each grade. */
export const THRESHOLDS = {
  best: 0.2,
  excellent: 2,
  good: 5,
  inaccuracy: 10,
  mistake: 20,
} as const;

/** Convert a score (side to move's view) into that side's win chance, 0-100. */
export function winPercent(score: Score): number {
  if (score.mate !== undefined) return score.mate > 0 ? 100 : 0;
  const cp = score.cp ?? 0;
  // Logistic curve fitted by Lichess to real game outcomes.
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export interface Classification {
  grade: Grade;
  loss: number; // win-probability points lost by the move
}

/**
 * @param before score of the position before my move (me to move)
 * @param after  score of the position after my move (opponent to move)
 * @param isEngineBest whether my move equals the engine's top choice
 */
export function classify(before: Score, after: Score, isEngineBest: boolean): Classification {
  const wpBefore = winPercent(before);
  const wpAfter = 100 - winPercent(after);
  const loss = Math.max(0, wpBefore - wpAfter);

  let grade: Grade;
  if (isEngineBest || loss < THRESHOLDS.best) grade = 'best';
  else if (loss < THRESHOLDS.excellent) grade = 'excellent';
  else if (loss < THRESHOLDS.good) grade = 'good';
  else if (loss < THRESHOLDS.inaccuracy) grade = 'inaccuracy';
  else if (loss < THRESHOLDS.mistake) grade = 'mistake';
  else grade = 'blunder';
  return { grade, loss };
}

export const GRADE_INFO: Record<Grade, { symbol: string; text: string; color: string }> = {
  best: { symbol: '★', text: 'Best', color: '#5fb04a' },
  excellent: { symbol: '!', text: 'Excellent', color: '#7fc24f' },
  good: { symbol: '✓', text: 'Good', color: '#9bb85a' },
  inaccuracy: { symbol: '?!', text: 'Inaccuracy', color: '#e6b422' },
  mistake: { symbol: '?', text: 'Mistake', color: '#e8832a' },
  blunder: { symbol: '??', text: 'Blunder', color: '#d64545' },
};
