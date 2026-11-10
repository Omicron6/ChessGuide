import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { ChessBoard } from './ChessBoard';
import { GradeIcon } from './GradeIcon';
import { Engine, type Analysis } from '../engine/engine';
import { classifyMove, GRADE_INFO, type Grade } from '../analysis/classify';
import { isMastered, recordReview, syncMistakes, type MistakeItem } from '../storage/mistakes';

type Side = 'w' | 'b';
const DEPTH = 16;

function dueItems(items: MistakeItem[]) {
  const now = Date.now();
  return items.filter((i) => i.due <= now && !isMastered(i)).sort((a, b) => b.loss - a.loss);
}

const parts = (uci: string) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
const toSan = (fen: string, uci: string) => new Chess(fen).move(parts(uci)).san;

export function MyMistakes() {
  const [items, setItems] = useState<MistakeItem[]>(() => syncMistakes());
  // The puzzle on screen only changes when the user presses Next.
  const [activeKey, setActiveKey] = useState<string | null>(() => dueItems(items)[0]?.key ?? null);
  const [fen, setFen] = useState('');
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'' | 'good' | 'bad'>('');
  const [result, setResult] = useState<Grade | null>(null);
  const [phase, setPhase] = useState<'ready' | 'checking' | 'solved' | 'revealed'>('ready');
  const [engineError, setEngineError] = useState<string | null>(null);

  const engine = useRef<Engine | null>(null);
  const cache = useRef(new Map<string, Promise<Analysis>>());
  const failed = useRef(false);
  const token = useRef(0);

  const current = items.find((i) => i.key === activeKey) ?? null;

  const getEval = useCallback((f: string) => {
    let p = cache.current.get(f);
    if (!p) {
      p = engine.current!.analyze(f, DEPTH);
      cache.current.set(f, p);
    }
    return p;
  }, []);

  useEffect(() => {
    engine.current = new Engine(setEngineError);
    const first = items.find((i) => i.key === activeKey);
    if (first) void getEval(first.fen); // warm up while the user looks at it
    return () => {
      engine.current?.terminate();
      engine.current = null;
      cache.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    token.current++;
    failed.current = false;
    setPhase('ready');
    setLastMove(null);
    setTone('');
    setResult(null);
    if (current) {
      setFen(current.fen);
      setMessage('Find a better move than the one you played.');
      if (engine.current) void getEval(current.fen);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  function markFailed() {
    if (!current || failed.current) return;
    failed.current = true;
    setItems(recordReview(current.key, false));
  }

  function handleMove(from: string, to: string, promotion?: string): boolean {
    if (!current || phase !== 'ready') return false;
    const chess = new Chess(current.fen);
    let uci: string;
    try {
      const m = chess.move({ from, to, promotion });
      uci = from + to + (m.promotion ?? '');
    } catch {
      return false;
    }
    if (uci === current.playedUci) {
      markFailed();
      setTone('bad');
      setMessage('That is the move you played in the game. Try something else.');
      return false;
    }

    // Show the move on the board while Stockfish checks it.
    setFen(chess.fen());
    setLastMove({ from, to });
    setPhase('checking');
    setMessage('Checking…');
    setTone('');
    const t = token.current;
    void (async () => {
      const before = await getEval(current.fen);
      let grade: Grade;
      if (chess.isCheckmate() || before.best === uci) grade = 'best';
      else grade = classifyMove(before.score, await engine.current!.scoreMove(current.fen, uci, DEPTH), false).grade;
      if (t !== token.current) return;
      setResult(grade);
      if (grade === 'best' || grade === 'excellent' || grade === 'good') {
        setPhase('solved');
        setTone('good');
        setMessage(`Correct. ${GRADE_INFO[grade].text} move.`);
        if (!failed.current) setItems(recordReview(current.key, true));
      } else {
        markFailed();
        setPhase('ready');
        setTone('bad');
        setMessage(`${GRADE_INFO[grade].text}. That still loses ground. Try again.`);
        setFen(current.fen);
        setLastMove(null);
      }
    })();
    return true;
  }

  function showAnswer() {
    if (!current || phase !== 'ready') return;
    markFailed();
    const chess = new Chess(current.fen);
    const san = chess.move(parts(current.bestUci)).san;
    setFen(chess.fen());
    setLastMove({ from: current.bestUci.slice(0, 2), to: current.bestUci.slice(2, 4) });
    setPhase('revealed');
    setTone('');
    setMessage(`The best move was ${san}.`);
  }

  function next() {
    const fresh = syncMistakes();
    setItems(fresh);
    setActiveKey(dueItems(fresh)[0]?.key ?? null);
  }

  const due = dueItems(items);
  const total = items.length;
  const mastered = items.filter(isMastered).length;
  const orientation: Side = current ? (new Chess(current.fen).turn() as Side) : 'w';

  return (
    <div className="play">
      <section className="board-col">
        <div className="board-holder">
          <ChessBoard
            fen={current ? fen || current.fen : new Chess().fen()}
            orientation={orientation}
            movable={current && phase === 'ready' ? orientation : null}
            onMove={handleMove}
            lastMove={lastMove}
            badge={result && lastMove ? { square: lastMove.to, grade: result } : null}
          />
          {!current && (
            <div className="result-modal">
              <h2>{total === 0 ? 'No mistakes yet' : 'All caught up'}</h2>
              <p className="muted">
                {total === 0
                  ? 'Finish a game on the Play tab. Your mistakes and blunders show up here as puzzles.'
                  : 'Nothing is due. Solved mistakes come back after 1, 3, 7, 21 and 60 days. Missed ones come back after 10 minutes.'}
              </p>
            </div>
          )}
        </div>
      </section>

      <aside className="panel">
        <header className="panel-head">
          <h2>My mistakes</h2>
          <span className="pill">{due.length} due</span>
        </header>
        <div className="panel-body">
          {current && (
            <>
              <div className={`prompt ${tone}`} aria-live="polite">
                <span className={`swatch ${orientation}`} />
                <div>
                  <strong>{message}</strong>
                </div>
              </div>
              <div className="card">
                <p className="label">From your game</p>
                <p className="row-icon">
                  <GradeIcon grade={current.grade as Grade} size={18} />
                  You played <strong>{toSan(current.fen, current.playedUci)}</strong>
                </p>
                <p className="muted">Lost about {Math.round(current.loss)}% of your winning chances.</p>
              </div>
            </>
          )}
          <div className="stats">
            <div>
              <strong>{total}</strong>
              <span>saved</span>
            </div>
            <div>
              <strong>{due.length}</strong>
              <span>due now</span>
            </div>
            <div>
              <strong>{mastered}</strong>
              <span>mastered</span>
            </div>
          </div>
          {engineError && <p className="error" role="alert">{engineError}</p>}
        </div>
        <footer className="panel-foot row">
          {current && phase === 'ready' && (
            <button className="btn" onClick={showAnswer}>
              Show answer
            </button>
          )}
          {current && (phase === 'solved' || phase === 'revealed') && (
            <button className="btn primary" onClick={next}>
              Next
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}
