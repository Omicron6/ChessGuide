import { loadGames } from './games';

// A mistake from one of my saved games, turned into a repeatable puzzle.
export interface MistakeItem {
  key: string; // `${gameId}:${plyId}` - unique per move
  fen: string; // position before my mistake (me to move)
  playedUci: string;
  playedSan: string;
  bestUci: string;
  loss: number; // win-probability points lost in the game
  grade: string;
  box: number; // Leitner box 0..SCHEDULE_DAYS.length
  due: number; // timestamp (ms) when it should be reviewed again
  attempts: number;
  correct: number;
  date: string; // game date
}

const KEY = 'chess-coach.mistakes';
const DAY = 24 * 60 * 60 * 1000;
/** Days to wait after a correct answer, by box. The last entry means "mastered for now". */
export const SCHEDULE_DAYS = [1, 3, 7, 21, 60];
const RETRY_DELAY = 10 * 60 * 1000;

export function loadMistakes(): MistakeItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as MistakeItem[];
  } catch {
    return [];
  }
}

function save(items: MistakeItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

/** Add any new mistakes/blunders from saved games. Existing items keep their progress. */
export function syncMistakes(): MistakeItem[] {
  const items = loadMistakes();
  const known = new Set(items.map((i) => i.key));
  let changed = false;
  for (const game of loadGames()) {
    for (const ply of game.plies) {
      if (ply.by !== 'me' || !ply.bestUci || !ply.grade) continue;
      if (ply.grade !== 'mistake' && ply.grade !== 'blunder') continue;
      if (ply.bestUci === ply.uci) continue;
      const key = `${game.id}:${ply.id}`;
      if (known.has(key)) continue;
      items.push({
        key,
        fen: ply.fenBefore,
        playedUci: ply.uci,
        playedSan: ply.san,
        bestUci: ply.bestUci,
        loss: ply.loss ?? 0,
        grade: ply.grade,
        box: 0,
        due: Date.now(),
        attempts: 0,
        correct: 0,
        date: game.date,
      });
      changed = true;
    }
  }
  if (changed) save(items);
  return items;
}

/** Record a review result and reschedule the item. */
export function recordReview(key: string, ok: boolean): MistakeItem[] {
  const items = loadMistakes().map((i) => {
    if (i.key !== key) return i;
    const attempts = i.attempts + 1;
    if (ok) {
      const box = Math.min(i.box + 1, SCHEDULE_DAYS.length);
      return {
        ...i,
        attempts,
        correct: i.correct + 1,
        box,
        due: Date.now() + SCHEDULE_DAYS[box - 1] * DAY,
      };
    }
    return { ...i, attempts, box: 0, due: Date.now() + RETRY_DELAY };
  });
  save(items);
  return items;
}

export function isMastered(i: MistakeItem) {
  return i.box >= SCHEDULE_DAYS.length;
}
