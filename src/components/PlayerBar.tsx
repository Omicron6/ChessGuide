import { Chess } from 'chess.js';

type Side = 'w' | 'b';

const START: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const GLYPH: Record<string, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' };
const ORDER = ['p', 'n', 'b', 'r', 'q'];

interface Props {
  name: string;
  rating: number | null;
  avatar: 'bot' | 'me';
  fen: string;
  color: Side; // the color this player has
  thinking: boolean;
}

/** Name, captured pieces and material lead, like the bars above/below a chess site's board. */
export function PlayerBar({ name, rating, avatar, fen, color, thinking }: Props) {
  const board = new Chess(fen).board().flat();
  const count = (c: Side) => {
    const n: Record<string, number> = { p: 0, n: 0, b: 0, r: 0, q: 0 };
    for (const sq of board) if (sq && sq.color === c && sq.type !== 'k') n[sq.type]++;
    return n;
  };
  const mine = count(color);
  const theirs = count(color === 'w' ? 'b' : 'w');
  const material = (n: Record<string, number>) => ORDER.reduce((s, t) => s + n[t] * VALUE[t], 0);
  const lead = material(mine) - material(theirs);
  const oppColor = color === 'w' ? 'b' : 'w';

  // Pieces this player has captured = opponent pieces missing from the start.
  const captured = ORDER.flatMap((t) => Array(Math.max(0, START[t] - theirs[t])).fill(t) as string[]);

  return (
    <div className="player-bar">
      <div className={`avatar ${avatar}`} aria-hidden="true">
        {avatar === 'bot' ? '♚' : '♔'}
      </div>
      <div className="player-info">
        <div className="player-name">
          {name}
          {rating !== null && <span className="rating">({rating})</span>}
          {thinking && <span className="thinking" aria-label="thinking" />}
        </div>
        <div className="captured" aria-label={`Captured: ${captured.length} pieces`}>
          <span className={`cap ${oppColor}`}>{captured.map((t) => GLYPH[t]).join('')}</span>
          {lead > 0 && <span className="lead">+{lead}</span>}
        </div>
      </div>
    </div>
  );
}
