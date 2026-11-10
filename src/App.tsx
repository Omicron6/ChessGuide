import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from './components/Board';
import { Engine, type Analysis, type Score } from './engine/engine';
import { classify, GRADE_INFO, type Grade } from './analysis/classify';
import { LEVELS } from './analysis/levels';
import { saveGame, type PlyRecord } from './storage/games';

type Side = 'w' | 'b';

const ANALYSIS_DEPTH = 12;
const BADGE_MS = 2500;
const GRADE_ORDER: Grade[] = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];

function readStored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function App() {
  const chessRef = useRef(new Chess());
  const analyzerRef = useRef<Engine | null>(null);
  const botRef = useRef<Engine | null>(null);
  const evalCache = useRef(new Map<string, Promise<Analysis>>());
  const gameId = useRef(0);
  const plyCounter = useRef(0);
  const pending = useRef(0);
  const savedRef = useRef(true);

  const [fen, setFen] = useState(chessRef.current.fen());
  const [plies, setPlies] = useState<PlyRecord[]>([]);
  const [myColor, setMyColor] = useState<Side>(() => readStored<Side>('cg.color', 'w'));
  const [levelIdx, setLevelIdx] = useState(() => readStored<number>('cg.level', 3));
  const [labelsOn, setLabelsOn] = useState(() => readStored<boolean>('cg.labels', true));
  const [flash, setFlash] = useState<{ grade: Grade; key: number } | null>(null);
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [botThinking, setBotThinking] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);

  useEffect(() => localStorage.setItem('cg.color', JSON.stringify(myColor)), [myColor]);
  useEffect(() => localStorage.setItem('cg.level', JSON.stringify(levelIdx)), [levelIdx]);
  useEffect(() => localStorage.setItem('cg.labels', JSON.stringify(labelsOn)), [labelsOn]);

  // Fade the badge after a short time.
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), BADGE_MS);
    return () => clearTimeout(t);
  }, [flash]);

  const getEval = useCallback((f: string): Promise<Analysis> => {
    let p = evalCache.current.get(f);
    if (!p) {
      p = analyzerRef.current!.analyze(f, ANALYSIS_DEPTH);
      evalCache.current.set(f, p);
    }
    return p;
  }, []);

  const persist = useCallback(
    (text: string, record: PlyRecord[]) => {
      if (savedRef.current) return;
      savedRef.current = true;
      if (record.length === 0) return;
      saveGame({
        id: `${Date.now()}`,
        date: new Date().toISOString(),
        myColor,
        level: LEVELS[levelIdx].name,
        result: text,
        pgn: chessRef.current.pgn(),
        plies: record,
      });
    },
    [levelIdx, myColor],
  );

  // A finished game is saved once the last move has been graded.
  useEffect(() => {
    if (result && !grading) persist(result, plies);
  }, [result, grading, plies, persist]);

  const checkGameOver = useCallback((iJustMoved: boolean): boolean => {
    const chess = chessRef.current;
    if (!chess.isGameOver()) return false;
    if (chess.isCheckmate()) setResult(iJustMoved ? 'You won by checkmate' : 'You lost by checkmate');
    else if (chess.isStalemate()) setResult('Draw by stalemate');
    else setResult('Draw');
    return true;
  }, []);

  const botMove = useCallback(
    async (id: number) => {
      const chess = chessRef.current;
      const bot = botRef.current!;
      setBotThinking(true);
      const fenBefore = chess.fen();
      const uci = await bot.botMove(fenBefore, LEVELS[levelIdx]);
      if (id !== gameId.current || !uci) return;
      setBotThinking(false);
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4) || undefined,
      });
      const ply: PlyRecord = {
        id: plyCounter.current++,
        san: move.san,
        uci,
        by: 'bot',
        fenBefore,
      };
      setPlies((p) => [...p, ply]);
      setFen(chess.fen());
      if (!checkGameOver(false)) void getEval(chess.fen()); // pre-compute the position I will face
    },
    [checkGameOver, getEval, levelIdx],
  );

  const gradeMove = useCallback(
    async (id: number, plyId: number, fenBefore: string, fenAfter: string, uci: string, over: boolean) => {
      pending.current++;
      setGrading(true);
      try {
        const before = await getEval(fenBefore);
        let after: Score;
        if (over) {
          const c = new Chess(fenAfter);
          after = c.isCheckmate() ? { mate: 0 } : { cp: 0 };
        } else {
          after = (await getEval(fenAfter)).score;
        }
        if (id !== gameId.current) return;
        const { grade, loss } = classify(before.score, after, before.best === uci);
        setPlies((p) =>
          p.map((x) => (x.id === plyId ? { ...x, grade, loss, bestUci: before.best } : x)),
        );
        setFlash({ grade, key: Date.now() });
      } finally {
        pending.current--;
        if (pending.current === 0) setGrading(false);
      }
    },
    [getEval],
  );

  const startGame = useCallback(
    (color: Side) => {
      const chess = chessRef.current;
      gameId.current++;
      const id = gameId.current;
      chess.reset();
      evalCache.current.clear();
      plyCounter.current = 0;
      savedRef.current = false;
      setPlies([]);
      setFlash(null);
      setResult(null);
      setBotThinking(false);
      setFen(chess.fen());
      void analyzerRef.current!.newGame();
      void botRef.current!.newGame().then(() => botRef.current!.setLevel(LEVELS[levelIdx]));
      if (color === 'b') void botMove(id);
      else void getEval(chess.fen());
    },
    [botMove, getEval, levelIdx],
  );

  // Create engines once; start the first game when they exist.
  const startRef = useRef(startGame);
  startRef.current = startGame;
  useEffect(() => {
    const analyzer = new Engine(setEngineError);
    const bot = new Engine(setEngineError);
    analyzerRef.current = analyzer;
    botRef.current = bot;
    startRef.current(myColor);
    return () => {
      analyzer.terminate();
      bot.terminate();
      analyzerRef.current = null;
      botRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function newGame() {
    if (!result) persist('Abandoned', plies);
    startGame(myColor);
  }

  function handleMove(from: string, to: string, promotion?: string) {
    const chess = chessRef.current;
    if (result || chess.turn() !== myColor) return;
    const id = gameId.current;
    const fenBefore = chess.fen();
    let move;
    try {
      move = chess.move({ from, to, promotion });
    } catch {
      return;
    }
    const uci = from + to + (promotion ?? '');
    const fenAfter = chess.fen();
    const ply: PlyRecord = { id: plyCounter.current++, san: move.san, uci, by: 'me', fenBefore };
    setPlies((p) => [...p, ply]);
    setFen(fenAfter);
    const over = checkGameOver(true);
    void gradeMove(id, ply.id, fenBefore, fenAfter, uci, over);
    if (!over) void botMove(id);
  }

  const lastPly = plies[plies.length - 1];
  const lastMove = lastPly ? { from: lastPly.uci.slice(0, 2), to: lastPly.uci.slice(2, 4) } : null;
  const myTurn = !result && chessRef.current.turn() === myColor;

  const counts = GRADE_ORDER.map((g) => ({
    grade: g,
    n: plies.filter((p) => p.by === 'me' && p.grade === g).length,
  }));

  const rows: { n: number; w?: PlyRecord; b?: PlyRecord }[] = [];
  plies.forEach((p, i) => {
    const white = i % 2 === 0;
    if (white) rows.push({ n: rows.length + 1, w: p });
    else rows[rows.length - 1].b = p;
  });

  const cell = (p?: PlyRecord) => {
    if (!p) return <td />;
    const info = labelsOn && p.by === 'me' && p.grade ? GRADE_INFO[p.grade] : null;
    return (
      <td>
        {p.san}
        {info && (
          <span className="mini" style={{ color: info.color }} title={info.text}>
            {' '}
            {info.symbol}
          </span>
        )}
      </td>
    );
  };

  return (
    <main className="app">
      <header>
        <h1>ChessGuide</h1>
        <p className="sub">Play the bot. Get feedback on your moves.</p>
      </header>

      {engineError && (
        <p className="error" role="alert">
          {engineError} Run <code>npm run copy-engine</code> and reload.
        </p>
      )}

      <div className="layout">
        <section>
          <Board
            fen={fen}
            orientation={myColor}
            lastMove={lastMove}
            disabled={!myTurn}
            onMove={handleMove}
          />
          <p className="status" aria-live="polite">
            {result ?? (botThinking ? 'Bot is thinking…' : myTurn ? 'Your move' : '')}
          </p>
        </section>

        <aside>
          <div className="feedback" aria-live="polite">
            {labelsOn && flash ? (
              <div className="badge" style={{ background: GRADE_INFO[flash.grade].color }}>
                <span className="sym">{GRADE_INFO[flash.grade].symbol}</span>
                <span>{GRADE_INFO[flash.grade].text}</span>
              </div>
            ) : labelsOn && grading ? (
              <div className="badge pending">…</div>
            ) : null}
          </div>

          <div className="controls">
            <label className="toggle">
              <input
                type="checkbox"
                checked={labelsOn}
                onChange={(e) => setLabelsOn(e.target.checked)}
              />
              Show move feedback
            </label>
            <label>
              Bot level
              <select value={levelIdx} onChange={(e) => setLevelIdx(Number(e.target.value))}>
                {LEVELS.map((l, i) => (
                  <option key={l.name} value={i}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              I play
              <select value={myColor} onChange={(e) => setMyColor(e.target.value as Side)}>
                <option value="w">White</option>
                <option value="b">Black</option>
              </select>
            </label>
            <button className="primary" onClick={newGame}>
              New game
            </button>
            <p className="hint">Level and color apply to the next game.</p>
          </div>

          <table className="moves">
            <tbody>
              {rows.map((r) => (
                <tr key={r.n}>
                  <th>{r.n}.</th>
                  {cell(r.w)}
                  {cell(r.b)}
                </tr>
              ))}
            </tbody>
          </table>

          {result && (
            <div className="summary">
              <strong>{result}</strong>
              <ul>
                {counts.map(({ grade, n }) => (
                  <li key={grade} style={{ color: GRADE_INFO[grade].color }}>
                    {GRADE_INFO[grade].symbol} {GRADE_INFO[grade].text}: {n}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
