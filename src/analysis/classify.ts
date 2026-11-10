import type { Score } from '../engine/engine';

export type Grade = 'book' | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export const GRADE_ORDER: Grade[] = [
  'book',
  'best',
  'excellent',
  'good',
  'inaccuracy',
  'mistake',
  'blunder',
];

/** Win-probability loss (percentage points) below which a move gets each grade. */
export const THRESHOLDS = {
  best: 0.5,
  excellent: 2.5,
  good: 5,
  inaccuracy: 10,
  mistake: 20,
} as const;

/** Convert a score (side to move's view) into that side's win chance, 0-100. */
export function winPercent(score: Score): number {
  if (score.mate !== undefined) return score.mate > 0 ? 100 : 0;
  const cp = Math.max(-1000, Math.min(1000, score.cp ?? 0));
  // Logistic curve Lichess fitted to real game outcomes.
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function gradeFromLoss(loss: number): Grade {
  if (loss < THRESHOLDS.best) return 'best';
  if (loss < THRESHOLDS.excellent) return 'excellent';
  if (loss < THRESHOLDS.good) return 'good';
  if (loss < THRESHOLDS.inaccuracy) return 'inaccuracy';
  if (loss < THRESHOLDS.mistake) return 'mistake';
  return 'blunder';
}

export interface Classification {
  grade: Grade;
  loss: number; // win-probability points lost by the move
}

/**
 * Both scores come from the same root position (the mover's point of view):
 * `best` is the engine's best line, `played` is the line after my move.
 */
export function classifyMove(best: Score, played: Score, isEngineBest: boolean): Classification {
  if (isEngineBest) return { grade: 'best', loss: 0 };
  const loss = Math.max(0, winPercent(best) - winPercent(played));
  return { grade: gradeFromLoss(loss), loss };
}

export const GRADE_INFO: Record<Grade, { symbol: string; text: string; color: string }> = {
  book: { symbol: 'book', text: 'Book', color: '#a88865' },
  best: { symbol: '★', text: 'Best', color: '#81b64c' },
  excellent: { symbol: '👍', text: 'Excellent', color: '#81b64c' },
  good: { symbol: '✓', text: 'Good', color: '#77915f' },
  inaccuracy: { symbol: '?!', text: 'Inaccuracy', color: '#f7c631' },
  mistake: { symbol: '?', text: 'Mistake', color: '#ffa459' },
  blunder: { symbol: '??', text: 'Blunder', color: '#fa412d' },
};

/** Short coach line shown after my move (feedback only, never reveals the best move). */
export const GRADE_LINE: Record<Grade, string> = {
  book: 'is a book move.',
  best: 'is the best move.',
  excellent: 'is an excellent move.',
  good: 'is a good move.',
  inaccuracy: 'is an inaccuracy.',
  mistake: 'is a mistake.',
  blunder: 'is a blunder.',
};
