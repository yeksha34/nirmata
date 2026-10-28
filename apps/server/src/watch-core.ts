/**
 * The waiting half of a file watcher: many small changes in a short time become one run.
 *
 * An editor saving, a sync client dropping a batch of files or a `git checkout` touches many files
 * a few moments apart; running on each would read half of them. `settle` runs once the changes have
 * been quiet for `quietMs`, but no later than `maxWaitMs` after the first of them, so a steady
 * trickle cannot hold the run off for ever. A run that is going when more changes come is followed
 * by one more, never by two at once.
 */

export interface Settler {
  /** Something changed. */
  poke(what?: string): void;
  /** Runs now if anything is waiting, without waiting for quiet. */
  flush(): Promise<void>;
  /** Resolves when nothing is waiting and nothing is running. */
  idle(): Promise<void>;
  stop(): void;
}

export interface SettleOptions {
  quietMs: number;
  maxWaitMs?: number;
  onError?: (error: unknown) => void;
}

export function settle(run: (what: string[]) => Promise<void>, options: SettleOptions): Settler {
  const { quietMs, maxWaitMs = Math.max(quietMs * 5, 10_000), onError = () => {} } = options;
  const waiting = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let first = 0;
  let running: Promise<void> | undefined;
  let again = false;
  let stopped = false;
  let dirty = false;

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    first = 0;
  };

  const start = () => {
    if (running) {
      again = true;
      return;
    }
    const batch = [...waiting];
    waiting.clear();
    dirty = false;
    running = run(batch)
      .catch(onError)
      .finally(() => {
        running = undefined;
        if (stopped) return;
        if (again) {
          again = false;
          start();
        }
      });
  };

  return {
    poke(what) {
      if (stopped) return;
      if (what !== undefined) waiting.add(what);
      dirty = true;
      const now = Date.now();
      if (!first) first = now;
      if (timer !== undefined) clearTimeout(timer);
      const delay = Math.max(0, Math.min(quietMs, first + maxWaitMs - now));
      timer = setTimeout(() => {
        clear();
        start();
      }, delay);
    },
    async flush() {
      clear();
      if (dirty) start();
      await this.idle();
    },
    async idle() {
      while (timer !== undefined || running) {
        if (running) await running;
        else await new Promise((r) => setTimeout(r, 10));
      }
    },
    stop() {
      stopped = true;
      clear();
      waiting.clear();
    },
  };
}

const NOISE_DIRS = new Set([".git", "__pycache__", "node_modules", ".vscode", ".idea", ".import"]);
const NOISE_FILE =
  /(?:~|\.swp|\.swx|\.tmp|\.temp|\.crdownload|\.part|\.import-tmp|\.pyc)$|^(?:\.~lock\.|~\$|\.#|4913$|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/;

/** A change to this path says nothing about the story: version control, caches, editors' scratch files. */
export function isNoise(path: string): boolean {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const name = parts[parts.length - 1] ?? "";
  return (
    parts.slice(0, -1).some((p) => NOISE_DIRS.has(p)) ||
    NOISE_DIRS.has(name) ||
    NOISE_FILE.test(name)
  );
}
