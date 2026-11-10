import { Chess } from 'chess.js';
import { Engine, scoreToCp } from './engine';
import type { BotLevel } from '../analysis/levels';

/** Pick the bot's move for the given level. Returns a UCI move or null if there are none. */
export async function chooseBotMove(engine: Engine, fen: string, level: BotLevel): Promise<string | null> {
  if (!level.weak) {
    return (await engine.search(fen, `movetime ${level.movetime ?? 500}`)).best;
  }

  const { depth, multipv, temperature, randomChance } = level.weak;
  const legal = new Chess(fen).moves({ verbose: true });
  if (legal.length === 0) return null;
  const toUci = (m: (typeof legal)[number]) => m.from + m.to + (m.promotion ?? '');

  const candidates = await engine.candidates(fen, depth, Math.min(multipv, legal.length));
  if (candidates.length === 0 || Math.random() < randomChance) {
    return toUci(legal[Math.floor(Math.random() * legal.length)]);
  }

  // Softmax over engine scores: close-to-best moves are likely, clearly bad ones rare.
  // Mates are clamped so a weak bot can still miss them sometimes.
  const best = Math.max(...candidates.map((c) => clamp(scoreToCp(c.score))));
  const weights = candidates.map((c) => Math.exp((clamp(scoreToCp(c.score)) - best) / temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i].move;
  }
  return candidates[0].move;
}

function clamp(cp: number) {
  return Math.max(-1500, Math.min(1500, cp));
}
