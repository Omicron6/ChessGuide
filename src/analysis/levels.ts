// Bot levels. Stockfish's own UCI_Elo cannot go below 1320, so lower levels pick
// from the engine's top moves with deliberate randomness, the way a weaker human
// plays reasonable-looking but imperfect moves. Ratings are rough estimates.

export interface BotLevel {
  id: string;
  name: string;
  rating: number; // approximate, for display
  /** Human-like weak play (rating < 1320). */
  weak?: {
    depth: number;
    multipv: number;
    temperature: number; // centipawns; higher = more willing to pick worse moves
    randomChance: number; // chance of a completely random legal move
  };
  /** Engine-limited play (UCI_Elo). Undefined elo = full strength. */
  elo?: number;
  movetime?: number;
}

export const LEVELS: BotLevel[] = [
  { id: 'l400', name: 'Beginner', rating: 400, weak: { depth: 2, multipv: 8, temperature: 260, randomChance: 0.3 } },
  { id: 'l600', name: 'Novice', rating: 600, weak: { depth: 3, multipv: 7, temperature: 190, randomChance: 0.18 } },
  { id: 'l800', name: 'Casual', rating: 800, weak: { depth: 4, multipv: 6, temperature: 130, randomChance: 0.1 } },
  { id: 'l1000', name: 'Improver', rating: 1000, weak: { depth: 6, multipv: 5, temperature: 85, randomChance: 0.05 } },
  { id: 'l1200', name: 'Club', rating: 1200, weak: { depth: 8, multipv: 4, temperature: 50, randomChance: 0.02 } },
  { id: 'l1400', name: 'Strong club', rating: 1400, elo: 1400, movetime: 300 },
  { id: 'l1600', name: 'Advanced', rating: 1600, elo: 1600, movetime: 300 },
  { id: 'l1800', name: 'Expert', rating: 1800, elo: 1800, movetime: 350 },
  { id: 'l2000', name: 'Candidate master', rating: 2000, elo: 2000, movetime: 400 },
  { id: 'l2200', name: 'Master', rating: 2200, elo: 2200, movetime: 450 },
  { id: 'l2500', name: 'Grandmaster', rating: 2500, elo: 2500, movetime: 600 },
  { id: 'max', name: 'Stockfish 19', rating: 3200, movetime: 1000 },
];

export const DEFAULT_LEVEL = 'l600';

export function levelById(id: string): BotLevel {
  return LEVELS.find((l) => l.id === id) ?? LEVELS[1];
}
