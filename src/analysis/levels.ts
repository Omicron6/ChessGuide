import type { BotLevel } from '../engine/engine';

export const LEVELS: BotLevel[] = [
  { name: 'Beginner', skill: 0, depth: 1 },
  { name: 'Casual', skill: 5, depth: 3 },
  { name: '~1350', elo: 1350, movetime: 150 },
  { name: '~1600', elo: 1600, movetime: 200 },
  { name: '~1900', elo: 1900, movetime: 250 },
  { name: '~2200', elo: 2200, movetime: 300 },
  { name: '~2600', elo: 2600, movetime: 400 },
  { name: 'Maximum', skill: 20, movetime: 600 },
];
