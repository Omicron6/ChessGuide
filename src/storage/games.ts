import type { Grade } from '../analysis/classify';

export interface PlyRecord {
  id: number;
  san: string;
  uci: string;
  by: 'me' | 'bot';
  fenBefore: string;
  grade?: Grade;
  loss?: number; // win-probability points lost (my moves only)
  bestUci?: string | null;
}

export interface SavedGame {
  id: string;
  date: string;
  myColor: 'w' | 'b';
  level: string;
  result: string;
  pgn: string;
  plies: PlyRecord[];
}

const KEY = 'chess-coach.games';

export function loadGames(): SavedGame[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as SavedGame[];
  } catch {
    return [];
  }
}

export function saveGame(game: SavedGame) {
  const games = loadGames();
  games.push(game);
  localStorage.setItem(KEY, JSON.stringify(games));
}
