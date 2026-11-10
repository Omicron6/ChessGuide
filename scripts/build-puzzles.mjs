// Builds public/puzzles.json from the Lichess puzzle database (CC0).
// Streams the download through zstd decompression; nothing large is written to disk.
//   node scripts/build-puzzles.mjs
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createZstdDecompress } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';
const MIN_RATING = 400;
const MAX_RATING = 1500;
const MIN_POPULARITY = 90;
const MIN_PLAYS = 500;
const MAX_DEVIATION = 100;
const SAMPLE_SIZE = 4000;

// Small seeded RNG so reruns give the same sample.
let seed = 12345;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const res = await fetch(URL);
if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);

// The file contains zstd "skippable frames" (magic 0x184D2A50, then a 4-byte size and
// 4 bytes of data) that Node's decoder does not skip. Remove every 12-byte occurrence
// before decompressing. The 8-byte prefix is specific enough that false matches in
// compressed data are practically impossible.
const SKIP_PREFIX = Buffer.from('502a4d1804000000', 'hex');
const SKIP_LEN = 12;

async function* stripSkippableFrames(source) {
  let carry = Buffer.alloc(0);
  for await (const chunk of source) {
    let buf = Buffer.concat([carry, chunk]);
    const parts = [];
    let pos = 0;
    let idx;
    while ((idx = buf.indexOf(SKIP_PREFIX, pos)) !== -1 && idx + SKIP_LEN <= buf.length) {
      parts.push(buf.subarray(pos, idx));
      pos = idx + SKIP_LEN;
    }
    // Keep a tail that might hold the start of a header split across chunks.
    const keepFrom = Math.max(pos, buf.length - (SKIP_LEN - 1));
    parts.push(buf.subarray(pos, keepFrom));
    carry = buf.subarray(keepFrom);
    const out = Buffer.concat(parts);
    if (out.length) yield out;
  }
  if (carry.length) yield carry;
}

const lines = createInterface({
  input: Readable.from(stripSkippableFrames(Readable.fromWeb(res.body))).pipe(
    createZstdDecompress(),
  ),
  crlfDelay: Infinity,
});

// Reservoir sampling over qualifying puzzles.
const sample = [];
let seen = 0;
let total = 0;
for await (const line of lines) {
  total++;
  if (total === 1) continue; // header
  const c = line.split(',');
  if (c.length < 8) continue;
  const [id, fen, moves, rating, dev, popularity, plays, themes] = c;
  const r = Number(rating);
  if (r < MIN_RATING || r > MAX_RATING) continue;
  if (Number(popularity) < MIN_POPULARITY || Number(plays) < MIN_PLAYS || Number(dev) > MAX_DEVIATION)
    continue;
  const row = [id, fen, moves, r, themes];
  seen++;
  if (sample.length < SAMPLE_SIZE) sample.push(row);
  else {
    const j = Math.floor(rand() * seen);
    if (j < SAMPLE_SIZE) sample[j] = row;
  }
}

sample.sort((a, b) => a[3] - b[3]);
mkdirSync('public', { recursive: true });
writeFileSync('public/puzzles.json', JSON.stringify(sample));
console.log(`Read ${total - 1} puzzles, ${seen} qualified, wrote ${sample.length} to public/puzzles.json`);
