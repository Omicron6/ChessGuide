import { useMemo, useState } from 'react';
import { Chess, type Square } from 'chess.js';

type Side = 'w' | 'b';

interface Props {
  fen: string;
  orientation: Side;
  lastMove: { from: string; to: string } | null;
  disabled: boolean;
  onMove: (from: string, to: string, promotion?: string) => void;
}

// Filled glyphs for both colors; color comes from CSS. \uFE0E forces text (not emoji) rendering.
const GLYPH: Record<string, string> = {
  k: '\u265A\uFE0E',
  q: '\u265B\uFE0E',
  r: '\u265C\uFE0E',
  b: '\u265D\uFE0E',
  n: '\u265E\uFE0E',
  p: '\u265F\uFE0E',
};
const NAMES: Record<string, string> = {
  k: 'king',
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
  p: 'pawn',
};
const FILES = 'abcdefgh';

export function Board({ fen, orientation, lastMove, disabled, onMove }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingPromo, setPendingPromo] = useState<{ from: string; to: string } | null>(null);

  const chess = useMemo(() => new Chess(fen), [fen]);
  const board = chess.board();

  const targets = useMemo(() => {
    if (!selected) return new Set<string>();
    return new Set(chess.moves({ square: selected as Square, verbose: true }).map((m) => m.to));
  }, [chess, selected]);

  const checkSquare = useMemo(() => {
    if (!chess.inCheck()) return null;
    const turn = chess.turn();
    for (let r = 0; r < 8; r++)
      for (let f = 0; f < 8; f++) {
        const p = board[r][f];
        if (p && p.type === 'k' && p.color === turn) return `${FILES[f]}${8 - r}`;
      }
    return null;
  }, [chess, board]);

  function clickSquare(sq: string) {
    if (disabled || pendingPromo) return;
    const piece = chess.get(sq as Square);
    if (selected && targets.has(sq)) {
      const from = chess.get(selected as Square);
      const isPromo = from?.type === 'p' && (sq[1] === '8' || sq[1] === '1');
      if (isPromo) setPendingPromo({ from: selected, to: sq });
      else onMove(selected, sq);
      setSelected(null);
      return;
    }
    if (piece && piece.color === chess.turn()) setSelected(sq === selected ? null : sq);
    else setSelected(null);
  }

  const rows = orientation === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const cols = orientation === 'w' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

  return (
    <div className="board-wrap">
      <div className="board" role="grid" aria-label="Chess board">
        {rows.map((r) =>
          cols.map((f) => {
            const sq = `${FILES[f]}${8 - r}`;
            const piece = board[r][f];
            const dark = (r + f) % 2 === 1;
            const cls = [
              'sq',
              dark ? 'dark' : 'light',
              selected === sq ? 'selected' : '',
              lastMove && (lastMove.from === sq || lastMove.to === sq) ? 'last' : '',
              checkSquare === sq ? 'check' : '',
            ].join(' ');
            return (
              <button
                key={sq}
                className={cls}
                role="gridcell"
                aria-label={`${sq}${piece ? ` ${piece.color === 'w' ? 'white' : 'black'} ${NAMES[piece.type]}` : ''}`}
                onClick={() => clickSquare(sq)}
              >
                {piece && <span className={`piece ${piece.color}`}>{GLYPH[piece.type]}</span>}
                {targets.has(sq) && <span className={piece ? 'ring' : 'dot'} />}
              </button>
            );
          }),
        )}
      </div>
      {pendingPromo && (
        <div className="promo" role="dialog" aria-label="Choose promotion piece">
          {(['q', 'r', 'b', 'n'] as const).map((p) => (
            <button
              key={p}
              aria-label={`Promote to ${NAMES[p]}`}
              onClick={() => {
                onMove(pendingPromo.from, pendingPromo.to, p);
                setPendingPromo(null);
              }}
            >
              <span className={`piece ${chess.turn()}`}>{GLYPH[p]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
