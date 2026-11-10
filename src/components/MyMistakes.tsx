import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Board } from './Board';
import { Engine, type Analysis } from '../engine/engine';
import { classify, GRADE_INFO } from '../analysis/classify';
import {
  isMastered,
  recordReview,
  syncMistakes,
  type MistakeItem,
} from '../storage/mistakes';

type Side = 'w' | 'b';
const DEPTH = 12;

function dueItems(items: MistakeItem[]) {
  const now = Date.now();
  return items.filter((i) => i.due <= now && !isMastered(i)).sort((a, b) => b.loss - a.loss);
}

function toSan(fen: string, uci: string) {
  return new Chess(fen).move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.slice(4) || undefined,
  }).san;
}

export function MyMistakes() {
  const [items, setItems] = useState<MistakeItem[]>(() => syncMistakes());
  // The puzzle on screen. It only changes when the user presses Next, so rescheduling a
  // solved item (which removes it from the due list) doesn't swap the screen under them.
  const [activeKey, setActiveKey] = useState<string | null>(() => dueItems(items)[0]?.key ?? null);
  const [fen, setFen] = useState('');
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [message, setMessage] = useState('');
  const [phase, setPhase] = useState<'ready' | 'checking' | 'solved' | 'revealed'>('ready');
  const [engineError, setEngineError] = useState<string | null>(null);

  const engine = useRef<Engine | null>(null);
  const cache = useRef(new Map<string, Promise<Analysis>>());
  const failed = useRef(false);
  const token = useRef(0);

  const current = items.find((i) => i.key === activeKey) ?? null;

  useEffect(() => {
    engine.current = new Engine(setEngineError);
    // Warm up the engine on the first puzzle while the user looks at it.
    const first = items.find((i) => i.key === activeKey);
    if (first) void getEval(first.fen);
    return () => {
      engine.current?.terminate();
      engine.current = null;
      cache.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getEval = useCallback((f: string) => {
    let p = cache.current.get(f);
    if (!p) {
      p = engine.current!.analyze(f, DEPTH);
      cache.current.set(f, p);
    }
    return p;
  }, []);

  // Set up the board whenever a different puzzle becomes active.
  useEffect(() => {
    token.current++;
    failed.current = false;
    setPhase('ready');
    setLastMove(null);
    if (current) {
      setFen(current.fen);
      setMessage('You made a mistake in this position. Find a better move.');
      if (engine.current) void getEval(current.fen);
    } else {
      setFen('');
      setMessage('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  function markFailed() {
    if (!current || failed.current) return;
    failed.current = true;
    setItems(recordReview(current.key, false));
  }

  async function handleMove(from: string, to: string, promotion?: string) {
    if (!current || phase !== 'ready') return;
    const uci = from + to + (promotion ?? '');

    if (uci === current.playedUci) {
      markFailed();
      setMessage('That is the move you played in the game. Try something else.');
      return;
    }

    const chess = new Chess(current.fen);
    try {
      chess.move({ from, to, promotion });
    } catch {
      return;
    }

    const t = token.current;
    setPhase('checking');
    setMessage('Checking…');
    const before = await getEval(current.fen);
    const after = chess.isGameOver()
      ? chess.isCheckmate()
        ? { mate: 0 }
        : { cp: 0 }
      : (await getEval(chess.fen())).score;
    if (t !== token.current) return;

    const { grade } = classify(before.score, after, before.best === uci);
    if (grade === 'best' || grade === 'excellent' || grade === 'good') {
      setFen(chess.fen());
      setLastMove({ from, to });
      setPhase('solved');
      setMessage(`Correct! ${GRADE_INFO[grade].symbol} ${GRADE_INFO[grade].text} move.`);
      if (!failed.current) setItems(recordReview(current.key, true));
    } else {
      markFailed();
      setPhase('ready');
      setMessage('That move still loses ground. Try again.');
    }
  }

  function showAnswer() {
    if (!current || phase !== 'ready') return;
    markFailed();
    const m = current.bestUci;
    const chess = new Chess(current.fen);
    const san = chess.move({
      from: m.slice(0, 2),
      to: m.slice(2, 4),
      promotion: m.slice(4) || undefined,
    }).san;
    setFen(chess.fen());
    setLastMove({ from: m.slice(0, 2), to: m.slice(2, 4) });
    setPhase('revealed');
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
    <div className="layout">
      <section>
        {current ? (
          <>
            <Board
              fen={fen || current.fen}
              orientation={orientation}
              lastMove={lastMove}
              disabled={phase !== 'ready'}
              onMove={handleMove}
            />
            <p className="status" aria-live="polite">{message}</p>
          </>
        ) : (
          <div className="summary">
            <strong>{total === 0 ? 'No mistakes saved yet' : 'All caught up'}</strong>
            <p className="hint">
              {total === 0
                ? 'Finish a game on the Play tab. Your mistakes and blunders will show up here as puzzles.'
                : 'Nothing is due right now. Solved mistakes come back after 1, 3, 7, 21 and 60 days. Missed ones come back after 10 minutes.'}
            </p>
          </div>
        )}
        {engineError && <p className="error" role="alert">{engineError}</p>}
      </section>

      <aside>
        <div className="controls">
          <div>
            Due now: <strong>{due.length}</strong>
          </div>
          <div>
            Saved mistakes: <strong>{total}</strong> · Mastered: <strong>{mastered}</strong>
          </div>
          {current && (
            <p className="hint">
              In the game you lost about {Math.round(current.loss)}% of your winning chances here
              ({current.grade}). You played {toSan(current.fen, current.playedUci)}.
            </p>
          )}
          {current && phase === 'ready' && <button onClick={showAnswer}>Show answer</button>}
          {current && (phase === 'solved' || phase === 'revealed') && (
            <button className="primary" onClick={next}>
              Next
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
