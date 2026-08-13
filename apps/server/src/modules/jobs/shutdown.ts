import type { JobQueue } from './queue.js';

export interface JobsShutdownOptions {
  signal?: NodeJS.Signals;
  /** Injectable so tests can trigger shutdown without touching the real process (mirrors core/server.ts's registerGracefulShutdown). */
  target?: NodeJS.Process | NodeJS.EventEmitter;
  /** Max time (ms) to wait for in-flight jobs to finish before forcing pg-boss to stop anyway. */
  timeoutMs?: number;
  onShutdownComplete?: () => void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Drains pg-boss as part of graceful shutdown (T3's registerGracefulShutdown
 * pattern, FND-05's "jobs" clause) — `boss.stop({ graceful: true, timeout })`
 * waits for jobs already in progress to finish (up to `timeoutMs`) instead
 * of abandoning them mid-run.
 */
export function registerJobsGracefulShutdown(
  boss: JobQueue,
  options: JobsShutdownOptions = {},
): () => Promise<void> {
  const {
    signal = 'SIGTERM',
    target = process,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onShutdownComplete,
  } = options;

  const handler = async (): Promise<void> => {
    await boss.stop({ graceful: true, timeout: timeoutMs, close: true });
    onShutdownComplete?.();
  };

  target.once(signal, handler);

  return handler;
}
