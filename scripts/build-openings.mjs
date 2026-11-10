// Builds public/openings.json from the Lichess chess-openings dataset
// (https://github.com/lichess-org/chess-openings).
// Output maps a position key (first 4 FEN fields) to [eco, name].
//   node scripts/build-openings.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { Chess } from 'chess.js';

const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/';
const out = {};
let lines = 0;

for (const file of ['a', 'b', 'c', 'd', 'e']) {
  const res = await fetch(`${BASE}${file}.tsv`);
  if (!res.ok) throw new Error(`${file}.tsv: HTTP ${res.status}`);
  const rows = (await res.text()).trim().split('\n').slice(1);
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t');
    const chess = new Chess();
    const keyOf = () => chess.fen().split(' ').slice(0, 4).join(' ');
    // Strip move numbers ("1." / "1...") and play each move. Every position along a
    // named line counts as book; only the final one carries the name.
    for (const san of pgn.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/)) {
      chess.move(san);
      if (!(keyOf() in out)) out[keyOf()] = 0;
    }
    const key = keyOf();
    // Several lines can reach the same position; keep the shortest (most general) name.
    if (!out[key] || name.length < out[key][1].length) out[key] = [eco, name];
    lines++;
  }
}

mkdirSync('public', { recursive: true });
writeFileSync('public/openings.json', JSON.stringify(out));
console.log(`Read ${lines} opening lines, wrote ${Object.keys(out).length} positions`);
