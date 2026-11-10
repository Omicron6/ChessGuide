import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { ChessBoard } from './ChessBoard';

type Side = 'w' | 'b';

interface Puzzle {
  id: string;
  fen: string;
  moves: string[]; // UCI; moves[0] is the opponent's move that sets up the puzzle
  rating: number;
  themes: string[];
}

type Stats = Record<string, { solved: number; failed: number }>;

const LEVEL_KEY = 'cg.puzzleLevel';
const STATS_KEY = 'cg.puzzleStats';
const START_LEVEL = 600;
const MIN_LEVEL = 400;
const MAX_LEVEL = 1500;
const LEVEL_STEP = 15;
const WINDOW = 150;

// Themes that describe a skill worth practicing (the rest are just labels like "short").
const THEME_LABELS: Record<string, string> = {
  mateIn1: 'Mate in 1',
  mateIn2: 'Mate in 2',
  mateIn3: 'Mate in 3',
  backRankMate: 'Back-rank mate',
  fork: 'Fork',
  pin: 'Pin',
  skewer: 'Skewer',
  discoveredAttack: 'Discovered attack',
  hangingPiece: 'Hanging piece',
  trappedPiece: 'Trapped piece',
  sacrifice: 'Sacrifice',
  deflection: 'Deflection',
  attraction: 'Attraction',
  doubleCheck: 'Double check',
  promotion: 'Promotion',
  advancedPawn: 'Advanced pawn',
  kingsideAttack: 'Kingside attack',
  queensideAttack: 'Queenside attack',
  defensiveMove: 'Defensive move',
  exposedKing: 'Exposed king',
  capturingDefender: 'Capturing the defender',
  intermezzo: 'In-between move',
  quietMove: 'Quiet move',
  endgame: 'Endgame',
  opening: 'Opening',
  middlegame: 'Middlegame',
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function Puzzles() {
  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [theme, setTheme] = useState('all');
  const [level, setLevel] = useState(() => readJson(LEVEL_KEY, START_LEVEL));
  const [stats, setStats] = useState<Stats>(() => readJson(STATS_KEY, {}));

  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [fen, setFen] = useState('');
  const [userColor, setUserColor] = useState<Side>('w');
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'loading' | 'playing' | 'solved' | 'revealed'>('loading');
  const [wrong, setWrong] = useState(false);

  const chessRef = useRef(new Chess());
  const step = useRef(1);
  const failed = useRef(false);
  const token = useRef(0);
  const seen = useRef(new Set<string>());
  const timers = useRef<number[]>([]);

  useEffect(() => localStorage.setItem(LEVEL_KEY, JSON.stringify(level)), [level]);
  useEffect(() => localStorage.setItem(STATS_KEY, JSON.stringify(stats)), [stats]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}puzzles.json`)
      .then((r) => {
        if (!r.ok) throw new Error('missing');
        return r.json() as Promise<[string, string, string, number, string][]>;
      })
      .then((rows) =>
        setPuzzles(
          rows.map(([id, f, m, rating, t]) => ({
            id,
            fen: f,
            moves: m.split(' '),
            rating,
            themes: t.split(' '),
          })),
        ),
      )
      .catch(() => setLoadError('Puzzle data not found. Run: node scripts/build-puzzles.mjs'));
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const themeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    puzzles?.forEach((p) => p.themes.forEach((t) => THEME_LABELS[t] && (counts[t] = (counts[t] ?? 0) + 1)));
    return counts;
  }, [puzzles]);

  const record = useCallback((p: Puzzle, ok: boolean) => {
    setStats((prev) => {
      const next = { ...prev };
      for (const t of p.themes) {
        if (!THEME_LABELS[t]) continue;
        const cur = next[t] ?? { solved: 0, failed: 0 };
        next[t] = ok ? { ...cur, solved: cur.solved + 1 } : { ...cur, failed: cur.failed + 1 };
      }
      return next;
    });
  }, []);

  const applyUci = (uci: string) => {
    const chess = chessRef.current;
    chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
    setFen(chess.fen());
    setLastMove({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
  };

  const nextPuzzle = useCallback(() => {
    if (!puzzles) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    token.current++;

    const matchTheme = (p: Puzzle) => theme === 'all' || p.themes.includes(theme);
    let pool: Puzzle[] = [];
    for (const w of [WINDOW, WINDOW * 2, WINDOW * 4, Infinity]) {
      pool = puzzles.filter(
        (p) => matchTheme(p) && Math.abs(p.rating - level) <= w && !seen.current.has(p.id),
      );
      if (pool.length) break;
    }
    if (!pool.length) {
      seen.current.clear(); // seen everything that matches; start over
      pool = puzzles.filter(matchTheme);
    }
    if (!pool.length) return;
    const p = pool[Math.floor(Math.random() * pool.length)];
    seen.current.add(p.id);

    const chess = new Chess(p.fen);
    chessRef.current = chess;
    step.current = 1;
    failed.current = false;
    const color: Side = chess.turn() === 'w' ? 'b' : 'w'; // the opponent moves first
    setPuzzle(p);
    setUserColor(color);
    setFen(p.fen);
    setLastMove(null);
    setMessage('');
    setWrong(false);
    setState('loading');

    const t = token.current;
    later(() => {
      if (t !== token.current) return;
      applyUci(p.moves[0]);
      setState('playing');
      setMessage(`Find the best move for ${color === 'w' ? 'White' : 'Black'}`);
    }, 500);
  }, [puzzles, theme, level]);

  // Load the first puzzle once data is ready, and again when the theme changes.
  useEffect(() => {
    if (puzzles) nextPuzzle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzles, theme]);

  function finish(ok: boolean) {
    if (!puzzle) return;
    setState('solved');
    if (!failed.current) {
      record(puzzle, true);
      setLevel((l) => Math.min(MAX_LEVEL, l + LEVEL_STEP));
      setMessage('Correct! Puzzle solved.');
    } else {
      setMessage(ok ? 'Solved, but you needed a retry.' : '');
    }
  }

  function handleMove(from: string, to: string, promotion?: string): boolean {
    if (!puzzle || state !== 'playing') return false;
    const uci = from + to + (promotion ?? '');
    const expected = puzzle.moves[step.current];

    // Any move that gives checkmate also counts, as on Lichess.
    const probe = new Chess(chessRef.current.fen());
    let mates = false;
    try {
      probe.move({ from, to, promotion });
      mates = probe.isCheckmate();
    } catch {
      return false;
    }

    if (uci !== expected && !mates) {
      if (!failed.current) {
        failed.current = true;
        record(puzzle, false);
        setLevel((l) => Math.max(MIN_LEVEL, l - LEVEL_STEP));
      }
      setMessage('Not the best move. Try again.');
      setWrong(true);
      return false;
    }
    setWrong(false);

    applyUci(uci);
    step.current++;
    if (mates || step.current >= puzzle.moves.length) {
      finish(true);
      return true;
    }
    setMessage('Good. Keep going…');
    const t = token.current;
    later(() => {
      if (t !== token.current) return;
      applyUci(puzzle.moves[step.current]);
      step.current++;
      setMessage('Your move');
    }, 450);
    return true;
  }

  function showSolution() {
    if (!puzzle || state !== 'playing') return;
    if (!failed.current) {
      failed.current = true;
      record(puzzle, false);
      setLevel((l) => Math.max(MIN_LEVEL, l - LEVEL_STEP));
    }
    setState('revealed');
    const t = token.current;
    let i = step.current;
    const playNext = () => {
      if (t !== token.current || i >= puzzle.moves.length) {
        setMessage('That was the solution.');
        return;
      }
      applyUci(puzzle.moves[i++]);
      later(playNext, 700);
    };
    playNext();
  }

  const weakest = useMemo(
    () =>
      Object.entries(stats)
        .map(([t, s]) => ({ t, ...s, n: s.solved + s.failed, rate: s.failed / (s.solved + s.failed) }))
        .filter((x) => x.n >= 3)
        .sort((a, b) => b.rate - a.rate)
        .slice(0, 4),
    [stats],
  );

  if (loadError) return <p className="error" role="alert">{loadError}</p>;
  if (!puzzles) return <p className="muted pad">Loading puzzles…</p>;

  const tone = state === 'solved' && !failed.current ? 'good' : wrong ? 'bad' : '';

  return (
    <div className="play">
      <section className="board-col">
        <div className="board-holder">
          <ChessBoard
            fen={fen || new Chess().fen()}
            orientation={userColor}
            movable={state === 'playing' ? userColor : null}
            onMove={handleMove}
            lastMove={lastMove}
          />
        </div>
      </section>

      <aside className="panel">
        <header className="panel-head">
          <h2>Puzzles</h2>
          <span className="pill">Level {level}</span>
        </header>
        <div className="panel-body">
          <div className={`prompt ${tone}`} aria-live="polite">
            <span className={`swatch ${userColor}`} />
            <div>
              <strong>{message || 'Loading…'}</strong>
              {puzzle && state !== 'loading' && <div className="muted">Puzzle rated ~{puzzle.rating}</div>}
            </div>
          </div>

          <label className="field">
            <span className="label">Theme</span>
            <select value={theme} onChange={(e) => setTheme(e.target.value)}>
              <option value="all">Any theme</option>
              {Object.keys(themeCounts)
                .sort((a, b) => THEME_LABELS[a].localeCompare(THEME_LABELS[b]))
                .map((t) => (
                  <option key={t} value={t}>
                    {THEME_LABELS[t]} ({themeCounts[t]})
                  </option>
                ))}
            </select>
          </label>

          <div className="card">
            <p className="label">Your weakest themes</p>
            {weakest.length === 0 ? (
              <p className="hint">Solve a few puzzles per theme to see this.</p>
            ) : (
              <ul className="bars">
                {weakest.map((w) => (
                  <li key={w.t}>
                    <span>{THEME_LABELS[w.t]}</span>
                    <span className="bar">
                      <span style={{ width: `${(w.solved / w.n) * 100}%` }} />
                    </span>
                    <span className="muted">
                      {w.solved}/{w.n}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="hint">
            Level goes up when you solve on the first try and down when you miss. It picks puzzles
            near your level and is not a chess rating.
          </p>
        </div>
        <footer className="panel-foot row">
          {state === 'playing' && (
            <button className="btn" onClick={showSolution}>
              Show solution
            </button>
          )}
          {(state === 'solved' || state === 'revealed' || failed.current) && (
            <button className="btn primary" onClick={nextPuzzle}>
              Next puzzle
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}
