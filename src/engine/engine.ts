// Thin UCI wrapper around a Stockfish Web Worker.
// Commands are serialized through a queue so only one search runs at a time per engine.

export interface Score {
  cp?: number; // centipawns, from the side to move's point of view
  mate?: number; // moves to mate (negative = side to move is being mated, 0 = already mated)
}

export interface Analysis {
  score: Score;
  best: string | null; // best move in UCI notation, e.g. "e2e4"
}

export interface Candidate {
  move: string;
  score: Score;
}

const ENGINE_URL = `${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`;

/** Convert a score to a single number for ranking (mates dominate everything). */
export function scoreToCp(s: Score): number {
  if (s.mate !== undefined) return s.mate > 0 ? 100000 - s.mate * 100 : -100000 - s.mate * 100;
  return s.cp ?? 0;
}

function parseScore(line: string): Score | null {
  if (/(lower|upper)bound/.test(line)) return null;
  const m = line.match(/score (cp|mate) (-?\d+)/);
  if (!m) return null;
  return m[1] === 'cp' ? { cp: Number(m[2]) } : { mate: Number(m[2]) };
}

export class Engine {
  private worker: Worker;
  private listeners = new Set<(line: string) => void>();
  private chain: Promise<unknown> = Promise.resolve();
  private multipv = 1;
  readonly ready: Promise<void>;

  constructor(onError?: (message: string) => void) {
    this.worker = new Worker(ENGINE_URL);
    this.worker.onmessage = (e: MessageEvent) => {
      const line = String(e.data);
      this.listeners.forEach((l) => l(line));
    };
    this.worker.onerror = () => onError?.('Stockfish failed to load.');
    this.ready = this.init();
  }

  terminate() {
    this.worker.terminate();
    this.listeners.clear();
  }

  private send(cmd: string) {
    this.worker.postMessage(cmd);
  }

  /** Send a command and resolve once a line satisfying `done` arrives. */
  private exec(
    cmd: string | null,
    done: (line: string) => boolean,
    onLine?: (line: string) => void,
  ): Promise<void> {
    return new Promise((resolve) => {
      const listener = (line: string) => {
        onLine?.(line);
        if (done(line)) {
          this.listeners.delete(listener);
          resolve();
        }
      };
      this.listeners.add(listener);
      if (cmd) this.send(cmd);
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async init() {
    await this.exec('uci', (l) => l === 'uciok');
    this.send('setoption name Hash value 32');
    await this.exec('isready', (l) => l === 'readyok');
  }

  private async sync(cmd: string) {
    this.send(cmd);
    await this.exec('isready', (l) => l === 'readyok');
  }

  private async setMultiPv(n: number) {
    if (this.multipv === n) return;
    this.multipv = n;
    await this.sync(`setoption name MultiPV value ${n}`);
  }

  newGame(): Promise<void> {
    return this.enqueue(async () => {
      await this.ready;
      await this.sync('ucinewgame');
    });
  }

  /** Full-strength or Elo-limited play. elo undefined = full strength. */
  setStrength(elo?: number): Promise<void> {
    return this.enqueue(async () => {
      await this.ready;
      if (elo !== undefined) {
        await this.sync('setoption name UCI_LimitStrength value true');
        await this.sync(`setoption name UCI_Elo value ${elo}`);
      } else {
        await this.sync('setoption name UCI_LimitStrength value false');
      }
    });
  }

  /** Raw search. Returns the final score of the principal line and the best move. */
  search(fen: string, go: string): Promise<Analysis> {
    return this.enqueue(async () => {
      await this.ready;
      await this.setMultiPv(1);
      let score: Score = { cp: 0 };
      let best: string | null = null;
      this.send(`position fen ${fen}`);
      await this.exec(
        `go ${go}`,
        (l) => l.startsWith('bestmove'),
        (l) => {
          if (l.startsWith('info') && l.includes(' score ')) score = parseScore(l) ?? score;
          if (l.startsWith('bestmove')) {
            const mv = l.split(' ')[1];
            best = mv && mv !== '(none)' ? mv : null;
          }
        },
      );
      return { score, best };
    });
  }

  /** Best move and score of a position. */
  analyze(fen: string, depth: number): Promise<Analysis> {
    return this.search(fen, `depth ${depth}`);
  }

  /**
   * Score one specific move, searched from the same root position as `analyze`.
   * The score is from the point of view of the side to move in `fen` (the mover),
   * so it can be compared directly with the best move's score.
   */
  async scoreMove(fen: string, uci: string, depth: number): Promise<Score> {
    return (await this.search(fen, `depth ${depth} searchmoves ${uci}`)).score;
  }

  /** Top `n` moves with scores (MultiPV), for the weak human-like bot levels. */
  candidates(fen: string, depth: number, n: number): Promise<Candidate[]> {
    return this.enqueue(async () => {
      await this.ready;
      await this.setMultiPv(n);
      const byIndex = new Map<number, Candidate>();
      this.send(`position fen ${fen}`);
      await this.exec(
        `go depth ${depth}`,
        (l) => l.startsWith('bestmove'),
        (l) => {
          if (!l.startsWith('info') || !l.includes(' pv ')) return;
          const score = parseScore(l);
          const idx = Number(l.match(/multipv (\d+)/)?.[1] ?? 1);
          const move = l.match(/ pv (\S+)/)?.[1];
          if (score && move) byIndex.set(idx, { move, score });
        },
      );
      return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
    });
  }
}
