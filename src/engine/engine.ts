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

export interface BotLevel {
  name: string;
  skill?: number; // Stockfish "Skill Level" 0-20
  elo?: number; // UCI_Elo (uses UCI_LimitStrength)
  depth?: number;
  movetime?: number; // ms
}

const ENGINE_URL = `${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`;

export class Engine {
  private worker: Worker;
  private listeners = new Set<(line: string) => void>();
  private chain: Promise<unknown> = Promise.resolve();
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
    await this.exec('isready', (l) => l === 'readyok');
  }

  private async sync(cmd: string) {
    this.send(cmd);
    await this.exec('isready', (l) => l === 'readyok');
  }

  newGame(): Promise<void> {
    return this.enqueue(async () => {
      await this.ready;
      await this.sync('ucinewgame');
    });
  }

  setLevel(level: BotLevel): Promise<void> {
    return this.enqueue(async () => {
      await this.ready;
      if (level.elo !== undefined) {
        await this.sync('setoption name UCI_LimitStrength value true');
        await this.sync(`setoption name UCI_Elo value ${level.elo}`);
      } else {
        await this.sync('setoption name UCI_LimitStrength value false');
        await this.sync(`setoption name Skill Level value ${level.skill ?? 20}`);
      }
    });
  }

  /** Search a position and return the final score and best move. */
  search(fen: string, go: string): Promise<Analysis> {
    return this.enqueue(async () => {
      await this.ready;
      let score: Score = { cp: 0 };
      this.send(`position fen ${fen}`);
      let best: string | null = null;
      await this.exec(
        `go ${go}`,
        (l) => l.startsWith('bestmove'),
        (l) => {
          if (l.startsWith('info') && l.includes(' score ') && !/(lower|upper)bound/.test(l)) {
            const m = l.match(/score (cp|mate) (-?\d+)/);
            if (m) score = m[1] === 'cp' ? { cp: Number(m[2]) } : { mate: Number(m[2]) };
          }
          if (l.startsWith('bestmove')) {
            const mv = l.split(' ')[1];
            best = mv && mv !== '(none)' ? mv : null;
          }
        },
      );
      return { score, best };
    });
  }

  analyze(fen: string, depth: number): Promise<Analysis> {
    return this.search(fen, `depth ${depth}`);
  }

  async botMove(fen: string, level: BotLevel): Promise<string | null> {
    const go = level.movetime ? `movetime ${level.movetime}` : `depth ${level.depth ?? 12}`;
    return (await this.search(fen, go)).best;
  }
}
