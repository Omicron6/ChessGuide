import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Arrow } from 'react-chessboard/dist/chessboard/types';
import { ChessBoard } from './components/ChessBoard';
import { GradeIcon } from './components/GradeIcon';
import { PlayerBar } from './components/PlayerBar';
import { Engine, type Analysis } from './engine/engine';
import { chooseBotMove } from './engine/bot';
import {
  classifyMove,
  GRADE_INFO,
  GRADE_LINE,
  GRADE_ORDER,
  THRESHOLDS,
  type Grade,
} from './analysis/classify';
import { DEFAULT_LEVEL, LEVELS, levelById } from './analysis/levels';
import { isBook, loadOpenings, openingName } from './analysis/openings';
import { saveGame, type PlyRecord } from './storage/games';

type Side = 'w' | 'b';
type ColorChoice = Side | 'random';

const ANALYSIS_DEPTH = 16;
const MIN_BOT_DELAY = 550; // ms, so the bot doesn't reply before you see your own move

function readStored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uciParts = (uci: string) => ({
  from: uci.slice(0, 2),
  to: uci.slice(2, 4),
  promotion: uci.slice(4) || undefined,
});

export function App({ onOpenMistakes }: { onOpenMistakes: () => void }) {
  const chessRef = useRef(new Chess());
  const analyzerRef = useRef<Engine | null>(null);
  const botRef = useRef<Engine | null>(null);
  const evalCache = useRef(new Map<string, Promise<Analysis>>());
  const gameId = useRef(0);
  const plyCounter = useRef(0);
  const pending = useRef(0);
  const savedRef = useRef(true);

  const [phase, setPhase] = useState<'setup' | 'playing' | 'over'>('setup');
  const [fen, setFen] = useState(chessRef.current.fen());
  const [plies, setPlies] = useState<PlyRecord[]>([]);
  const [view, setView] = useState<number | null>(null); // null = live position
  const [myColor, setMyColor] = useState<Side>('w');
  const [colorChoice, setColorChoice] = useState<ColorChoice>(() => readStored('cg.colorChoice', 'w'));
  const [levelId, setLevelId] = useState<string>(() => readStored('cg.levelId', DEFAULT_LEVEL));
  const [labelsOn, setLabelsOn] = useState(() => readStored<boolean>('cg.labels', true));
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [botThinking, setBotThinking] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [bookReady, setBookReady] = useState(false);
  const botGen = useRef(0); // bumped to cancel a bot move in flight (e.g. on resign)

  const level = levelById(levelId);

  useEffect(() => localStorage.setItem('cg.colorChoice', JSON.stringify(colorChoice)), [colorChoice]);
  useEffect(() => localStorage.setItem('cg.levelId', JSON.stringify(levelId)), [levelId]);
  useEffect(() => localStorage.setItem('cg.labels', JSON.stringify(labelsOn)), [labelsOn]);
  useEffect(() => void loadOpenings().then(() => setBookReady(true)), []);

  useEffect(() => {
    const analyzer = new Engine(setEngineError);
    const bot = new Engine(setEngineError);
    analyzerRef.current = analyzer;
    botRef.current = bot;
    return () => {
      analyzer.terminate();
      bot.terminate();
      analyzerRef.current = null;
      botRef.current = null;
    };
  }, []);

  const getEval = useCallback((f: string): Promise<Analysis> => {
    let p = evalCache.current.get(f);
    if (!p) {
      p = analyzerRef.current!.analyze(f, ANALYSIS_DEPTH);
      evalCache.current.set(f, p);
    }
    return p;
  }, []);

  // ---- saving ----------------------------------------------------------------
  const persist = useCallback(
    (text: string, record: PlyRecord[]) => {
      if (savedRef.current) return;
      savedRef.current = true;
      if (record.length === 0) return;
      saveGame({
        id: `${Date.now()}`,
        date: new Date().toISOString(),
        myColor,
        level: `${level.name} (${level.rating})`,
        result: text,
        pgn: chessRef.current.pgn(),
        plies: record,
      });
    },
    [level, myColor],
  );

  // A finished game is saved once the last move has been graded.
  useEffect(() => {
    if (result && !grading) persist(result, plies);
  }, [result, grading, plies, persist]);

  const endGame = useCallback((text: string) => {
    setResult(text);
    setPhase('over');
    setShowResult(true);
    setBotThinking(false);
  }, []);

  const checkGameOver = useCallback(
    (iJustMoved: boolean): boolean => {
      const c = chessRef.current;
      if (!c.isGameOver()) return false;
      if (c.isCheckmate()) endGame(iJustMoved ? 'You won by checkmate' : 'You lost by checkmate');
      else if (c.isStalemate()) endGame('Draw by stalemate');
      else if (c.isThreefoldRepetition()) endGame('Draw by repetition');
      else if (c.isInsufficientMaterial()) endGame('Draw by insufficient material');
      else endGame('Draw by 50-move rule');
      return true;
    },
    [endGame],
  );

  // ---- bot -------------------------------------------------------------------
  const playBot = useCallback(
    async (id: number) => {
      const c = chessRef.current;
      const gen = botGen.current;
      setBotThinking(true);
      const fenBefore = c.fen();
      const [uci] = await Promise.all([chooseBotMove(botRef.current!, fenBefore, level), sleep(MIN_BOT_DELAY)]);
      if (id !== gameId.current || gen !== botGen.current || !uci) return;
      setBotThinking(false);
      const move = c.move(uciParts(uci));
      const ply: PlyRecord = {
        id: plyCounter.current++,
        san: move.san,
        uci,
        by: 'bot',
        fenBefore,
        fenAfter: c.fen(),
      };
      setPlies((p) => [...p, ply]);
      setFen(c.fen());
      if (!checkGameOver(false)) void getEval(c.fen()); // pre-compute the position I'll face
    },
    [checkGameOver, getEval, level],
  );

  // ---- grading my move ---------------------------------------------------------
  const gradeMove = useCallback(
    async (id: number, plyId: number, fenBefore: string, fenAfter: string, uci: string) => {
      pending.current++;
      setGrading(true);
      try {
        let grade: Grade;
        let loss = 0;
        let bestUci: string | null = null;
        if (new Chess(fenAfter).isCheckmate()) {
          grade = 'best';
          bestUci = uci;
        } else {
          const before = await getEval(fenBefore);
          bestUci = before.best;
          if (before.best === uci) {
            grade = 'best';
          } else {
            const played = await analyzerRef.current!.scoreMove(fenBefore, uci, ANALYSIS_DEPTH);
            ({ grade, loss } = classifyMove(before.score, played, false));
          }
          // The opening list includes named traps (e.g. "Fool's Mate"), so a book move
          // only counts as Book if the engine agrees it's sound.
          if (isBook(fenAfter) && loss < THRESHOLDS.good) grade = 'book';
        }
        if (id !== gameId.current) return;
        setPlies((p) => p.map((x) => (x.id === plyId ? { ...x, grade, loss, bestUci } : x)));
      } finally {
        pending.current--;
        if (pending.current === 0) setGrading(false);
      }
    },
    [getEval],
  );

  // ---- game lifecycle -----------------------------------------------------------
  function startGame() {
    const color: Side = colorChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colorChoice;
    const c = chessRef.current;
    gameId.current++;
    const id = gameId.current;
    c.reset();
    evalCache.current.clear();
    plyCounter.current = 0;
    pending.current = 0;
    savedRef.current = false;
    setGrading(false);
    setMyColor(color);
    setPlies([]);
    setView(null);
    setResult(null);
    setShowResult(false);
    setBotThinking(false);
    setFen(c.fen());
    setPhase('playing');
    void analyzerRef.current!.newGame();
    void botRef.current!.newGame().then(() => botRef.current!.setStrength(level.elo));
    if (color === 'b') void playBot(id);
    else void getEval(c.fen());
  }

  function resign() {
    if (phase !== 'playing') return;
    botGen.current++; // cancel any bot move in flight; grading of my moves continues
    endGame('You resigned');
  }

  function handleMove(from: string, to: string, promotion?: string): boolean {
    const c = chessRef.current;
    if (phase !== 'playing' || c.turn() !== myColor || view !== null) return false;
    const id = gameId.current;
    const fenBefore = c.fen();
    let move;
    try {
      move = c.move({ from, to, promotion });
    } catch {
      return false;
    }
    const uci = from + to + (move.promotion ?? '');
    const fenAfter = c.fen();
    const ply: PlyRecord = { id: plyCounter.current++, san: move.san, uci, by: 'me', fenBefore, fenAfter };
    setPlies((p) => [...p, ply]);
    setFen(fenAfter);
    void gradeMove(id, ply.id, fenBefore, fenAfter, uci);
    if (!checkGameOver(true)) void playBot(id);
    return true;
  }

  // ---- navigation -----------------------------------------------------------------
  const lastIdx = plies.length - 1;
  const viewIdx = view ?? lastIdx;
  const goTo = useCallback(
    (i: number) => {
      const clamped = Math.max(-1, Math.min(lastIdx, i));
      setView(clamped === lastIdx ? null : clamped);
    },
    [lastIdx],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase === 'setup' || (e.target as HTMLElement).closest('input, select, textarea')) return;
      if (e.key === 'ArrowLeft') goTo(viewIdx - 1);
      else if (e.key === 'ArrowRight') goTo(viewIdx + 1);
      else if (e.key === 'ArrowUp') goTo(-1);
      else if (e.key === 'ArrowDown') goTo(lastIdx);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, viewIdx, lastIdx, phase]);

  // ---- derived view state -------------------------------------------------------------
  const START_FEN = new Chess().fen();
  const shownPly = phase !== 'setup' && viewIdx >= 0 ? plies[viewIdx] : undefined;
  const shownFen = phase === 'setup' ? START_FEN : view === null ? fen : (shownPly?.fenAfter ?? START_FEN);
  const lastMove = shownPly ? { from: shownPly.uci.slice(0, 2), to: shownPly.uci.slice(2, 4) } : null;
  const reviewing = phase === 'over';

  // My most recent move (in the viewed history), for the coach line and board badge.
  const myLast = useMemo(() => {
    if (phase === 'setup') return undefined;
    for (let i = viewIdx; i >= 0; i--) if (plies[i].by === 'me') return plies[i];
    return undefined;
  }, [plies, viewIdx, phase]);

  let badge = null;
  if (labelsOn && myLast?.grade) {
    const sq = myLast.uci.slice(2, 4);
    // Hide it if the bot has since moved onto that square.
    const covered = shownPly && shownPly.by === 'bot' && shownPly.uci.slice(2, 4) === sq;
    if (!covered) badge = { square: sq, grade: myLast.grade };
  }

  // After the game, show the engine's best move for my non-best moves.
  const arrows: Arrow[] = [];
  if (reviewing && shownPly?.by === 'me' && shownPly.bestUci && shownPly.bestUci !== shownPly.uci && shownPly.grade !== 'book') {
    arrows.push([shownPly.bestUci.slice(0, 2), shownPly.bestUci.slice(2, 4)] as Arrow);
  }

  const opening = useMemo(() => {
    for (let i = viewIdx; i >= 0; i--) {
      const o = openingName(plies[i].fenAfter);
      if (o) return o;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plies, viewIdx, bookReady]);

  const counts = GRADE_ORDER.map((g) => ({ g, n: plies.filter((p) => p.by === 'me' && p.grade === g).length }));
  const myGraded = plies.filter((p) => p.by === 'me' && p.grade);
  const mistakesFound = plies.filter((p) => p.by === 'me' && (p.grade === 'mistake' || p.grade === 'blunder')).length;

  const rows: { n: number; w?: PlyRecord; b?: PlyRecord; wi: number; bi: number }[] = [];
  plies.forEach((p, i) => {
    const whiteMove = new Chess(p.fenBefore).turn() === 'w';
    if (whiteMove || rows.length === 0) rows.push({ n: rows.length + 1, wi: -2, bi: -2 });
    const r = rows[rows.length - 1];
    if (whiteMove) {
      r.w = p;
      r.wi = i;
    } else {
      r.b = p;
      r.bi = i;
    }
  });

  const moveListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    moveListRef.current?.querySelector('.mv.active')?.scrollIntoView({ block: 'nearest' });
  }, [viewIdx, plies.length]);

  const moveCell = (p: PlyRecord | undefined, i: number) => {
    if (!p) return <span className="mv empty" />;
    const showGrade = labelsOn && p.by === 'me' && p.grade;
    return (
      <button className={`mv${i === viewIdx ? ' active' : ''}`} onClick={() => goTo(i)}>
        {showGrade && <GradeIcon grade={p.grade!} size={16} />}
        <span>{p.san}</span>
      </button>
    );
  };

  const myTurn = phase === 'playing' && chessRef.current.turn() === myColor;
  const botName = level.id === 'max' ? 'Stockfish 19' : `${level.name} bot`;

  // ---- render ------------------------------------------------------------------------
  return (
    <div className="play">
      <section className="board-col">
        <PlayerBar
          name={phase === 'setup' ? 'Opponent' : botName}
          rating={phase === 'setup' ? null : level.rating}
          avatar="bot"
          fen={shownFen}
          color={myColor === 'w' ? 'b' : 'w'}
          thinking={botThinking}
        />
        <div className="board-holder">
          <ChessBoard
            fen={shownFen}
            orientation={myColor}
            movable={phase === 'playing' && view === null ? myColor : null}
            onMove={handleMove}
            lastMove={lastMove}
            badge={badge}
            arrows={arrows}
          />
          {phase === 'over' && showResult && (
            <div className="result-modal" role="dialog" aria-label="Game over">
              <button className="close" aria-label="Close" onClick={() => setShowResult(false)}>
                ×
              </button>
              <h2>{result}</h2>
              <p className="muted">
                vs {botName} ({level.rating})
              </p>
              {myGraded.length > 0 && (
                <ul className="tally">
                  {counts
                    .filter((c) => c.n > 0)
                    .map(({ g, n }) => (
                      <li key={g}>
                        <GradeIcon grade={g} size={18} />
                        <span>{GRADE_INFO[g].text}</span>
                        <strong>{n}</strong>
                      </li>
                    ))}
                </ul>
              )}
              {grading && <p className="muted">Finishing analysis…</p>}
              <div className="modal-actions">
                <button className="btn" onClick={() => setShowResult(false)}>
                  Review game
                </button>
                {mistakesFound > 0 && (
                  <button className="btn" onClick={onOpenMistakes}>
                    Practice {mistakesFound} mistake{mistakesFound > 1 ? 's' : ''}
                  </button>
                )}
                <button className="btn primary" onClick={() => setPhase('setup')}>
                  New game
                </button>
              </div>
            </div>
          )}
        </div>
        <PlayerBar name="You" rating={null} avatar="me" fen={shownFen} color={myColor} thinking={false} />
      </section>

      <aside className="panel">
        {phase === 'setup' ? (
          <>
            <header className="panel-head">
              <h2>Play vs Bot</h2>
            </header>
            <div className="panel-body">
              <p className="label">Bot strength</p>
              <div className="level-grid">
                {LEVELS.map((l) => (
                  <button
                    key={l.id}
                    className={`level${l.id === levelId ? ' selected' : ''}`}
                    aria-pressed={l.id === levelId}
                    onClick={() => setLevelId(l.id)}
                  >
                    <strong>{l.rating === 3200 ? 'Max' : l.rating}</strong>
                    <span>{l.name}</span>
                  </button>
                ))}
              </div>
              <p className="hint">Ratings are rough estimates.</p>

              <p className="label">I play as</p>
              <div className="seg" role="group" aria-label="Color">
                {(
                  [
                    ['w', 'White'],
                    ['random', 'Random'],
                    ['b', 'Black'],
                  ] as const
                ).map(([v, t]) => (
                  <button key={v} aria-pressed={colorChoice === v} onClick={() => setColorChoice(v)}>
                    <span className={`swatch ${v}`} />
                    {t}
                  </button>
                ))}
              </div>

              <label className="switch">
                <input type="checkbox" checked={labelsOn} onChange={(e) => setLabelsOn(e.target.checked)} />
                <span className="track" />
                Show move feedback
              </label>
            </div>
            <footer className="panel-foot">
              <button className="btn primary big" onClick={startGame} disabled={!!engineError}>
                Play
              </button>
            </footer>
          </>
        ) : (
          <>
            <header className="panel-head">
              <h2>{reviewing ? 'Game review' : `vs ${botName}`}</h2>
              <label className="switch small" title="Show move feedback">
                <input type="checkbox" checked={labelsOn} onChange={(e) => setLabelsOn(e.target.checked)} />
                <span className="track" />
                Feedback
              </label>
            </header>

            <div className="opening-line">
              {opening ? (
                <>
                  <span className="eco">{opening.eco}</span> {opening.name}
                </>
              ) : (
                <span className="muted">{plies.length ? 'Out of book' : 'Starting position'}</span>
              )}
            </div>

            <div className="coach" aria-live="polite">
              {!labelsOn ? (
                <span className="muted">Feedback is off. Your moves are still saved for review.</span>
              ) : myLast?.grade ? (
                <>
                  <GradeIcon grade={myLast.grade} size={30} />
                  <div>
                    <strong style={{ color: GRADE_INFO[myLast.grade].color }}>
                      {myLast.san} {GRADE_LINE[myLast.grade]}
                    </strong>
                    {reviewing && shownPly === myLast && arrows.length > 0 && (
                      <div className="muted">
                        Best was{' '}
                        {new Chess(myLast.fenBefore).move(uciParts(myLast.bestUci!)).san}
                        {myLast.loss ? ` · lost ${myLast.loss.toFixed(1)}% win chance` : ''}
                      </div>
                    )}
                  </div>
                </>
              ) : myLast ? (
                <span className="muted">Analyzing {myLast.san}…</span>
              ) : (
                <span className="muted">{myTurn ? 'Your move.' : 'Waiting for the bot…'}</span>
              )}
            </div>

            <div className="move-list" ref={moveListRef}>
              {rows.map((r) => (
                <div className="move-row" key={r.n}>
                  <span className="num">{r.n}.</span>
                  {r.w ? moveCell(r.w, r.wi) : <span className="mv empty">…</span>}
                  {moveCell(r.b, r.bi)}
                </div>
              ))}
            </div>

            <div className="nav" role="group" aria-label="Move navigation">
              <button aria-label="First move" onClick={() => goTo(-1)} disabled={viewIdx < 0}>
                ⏮
              </button>
              <button aria-label="Previous move" onClick={() => goTo(viewIdx - 1)} disabled={viewIdx < 0}>
                ◀
              </button>
              <button aria-label="Next move" onClick={() => goTo(viewIdx + 1)} disabled={view === null}>
                ▶
              </button>
              <button aria-label="Last move" onClick={() => goTo(lastIdx)} disabled={view === null}>
                ⏭
              </button>
            </div>

            <footer className="panel-foot row">
              {phase === 'playing' ? (
                <>
                  <button className="btn" onClick={resign}>
                    Resign
                  </button>
                  <span className="muted status">
                    {view !== null ? 'Viewing history' : botThinking ? 'Bot is thinking…' : myTurn ? 'Your move' : ''}
                  </span>
                </>
              ) : (
                <>
                  <button className="btn" onClick={() => setShowResult(true)}>
                    Result
                  </button>
                  <button className="btn primary" onClick={() => setPhase('setup')}>
                    New game
                  </button>
                </>
              )}
            </footer>
          </>
        )}
        {engineError && (
          <p className="error" role="alert">
            {engineError} Run <code>npm run copy-engine</code> and reload.
          </p>
        )}
      </aside>
    </div>
  );
}
