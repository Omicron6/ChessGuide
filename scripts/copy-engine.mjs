// Copies the single-threaded lite Stockfish build into public/engine so the
// browser can load it as a Web Worker (no special server headers needed).
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('public/engine', { recursive: true });
for (const f of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) {
  copyFileSync(`node_modules/stockfish/bin/${f}`, `public/engine/${f}`);
}
console.log('Stockfish engine files copied to public/engine');
