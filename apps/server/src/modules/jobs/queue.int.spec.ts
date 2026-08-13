// Runs pg-boss for real against a PGlite-backed database via pg-boss's own
// `fromPglite` adapter + `backend: 'pglite'` — a real embedded PostgreSQL
// engine (WASM), not a mock. No Docker daemon is available in this sandbox
// (see .specs/STATE.md AD-007), so this is the honest substitute: unlike
// T27's storage module (MinIO has no embeddable equivalent), pg-boss ships
// first-class PGlite support, so this test exercises real pg-boss code —
// real job persistence, real polling/fetch, real graceful-stop draining —
// against a real Postgres engine, not test doubles.
import { EventEmitter } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import { fromPglite } from 'pg-boss';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../core/config.js';
import { defineJob, enqueue, type JobQueue, startJobs } from './queue.js';
import { registerJobsGracefulShutdown } from './shutdown.js';

function testConfig() {
  return loadConfig({ NODE_ENV: 'test' });
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('pg-boss job queue (T28, FND-05)', () => {
  let client: PGlite;
  let boss: JobQueue | undefined;

  afterEach(async () => {
    if (boss) {
      await boss.stop({ graceful: false, timeout: 1000 });
      boss = undefined;
    }
    await client?.close();
  });

  it('a job sent via enqueue is executed by the handler registered via defineJob', async () => {
    client = new PGlite();
    boss = await startJobs(testConfig(), { db: fromPglite(client), backend: 'pglite' });

    let received: unknown;
    await defineJob(
      boss,
      'echo',
      async (payload) => {
        received = payload;
      },
      { pollingIntervalSeconds: 0.5 },
    );

    await enqueue(boss, 'echo', { hello: 'world' });

    await waitUntil(() => received !== undefined, 8000);
    expect(received).toEqual({ hello: 'world' });
  });

  it('persists exactly one durable job per enqueue call — the handler observes it once', async () => {
    client = new PGlite();
    boss = await startJobs(testConfig(), { db: fromPglite(client), backend: 'pglite' });

    let callCount = 0;
    await defineJob(
      boss,
      'count-me',
      async () => {
        callCount += 1;
      },
      { pollingIntervalSeconds: 0.5 },
    );

    await enqueue(boss, 'count-me', { n: 1 });

    await waitUntil(() => callCount >= 1, 8000);
    // Give the poller a couple more cycles to prove no duplicate delivery.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(callCount).toBe(1);
  });

  it('graceful shutdown waits for an in-flight job to finish before completing, given enough timeout budget', async () => {
    client = new PGlite();
    boss = await startJobs(testConfig(), { db: fromPglite(client), backend: 'pglite' });

    let jobCompletedAt: number | undefined;
    await defineJob(
      boss,
      'slow-job',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        jobCompletedAt = Date.now();
      },
      { pollingIntervalSeconds: 0.5 },
    );

    await enqueue(boss, 'slow-job', {});
    // Let the poller pick the job up and start executing it before we signal shutdown.
    await new Promise((resolve) => setTimeout(resolve, 700));

    const target = new EventEmitter();
    const shutdownStartedAt = Date.now();
    const shutdownHandlerDone = new Promise<void>((resolve) => {
      target.once('__shutdown_done__', resolve);
    });
    registerJobsGracefulShutdown(boss, {
      target,
      timeoutMs: 5000,
      onShutdownComplete: () => target.emit('__shutdown_done__'),
    });

    target.emit('SIGTERM');
    await shutdownHandlerDone;
    const shutdownResolvedAt = Date.now();

    // The in-flight job actually finished — proving stop() waited instead of abandoning it.
    expect(jobCompletedAt).toBeDefined();
    expect(jobCompletedAt as number).toBeLessThanOrEqual(shutdownResolvedAt + 50);
    // And shutdown took a meaningful amount of time (bounded by the job's own 600ms delay),
    // not an instant pass-through that would mean graceful draining never actually blocked.
    expect(shutdownResolvedAt - shutdownStartedAt).toBeGreaterThanOrEqual(400);
  });

  it('graceful shutdown does not block past the configured timeout for a job that runs longer than it', async () => {
    client = new PGlite();
    boss = await startJobs(testConfig(), { db: fromPglite(client), backend: 'pglite' });

    let jobCompleted = false;
    let resolveJobFinished!: () => void;
    const jobFinished = new Promise<void>((resolve) => {
      resolveJobFinished = resolve;
    });
    await defineJob(
      boss,
      'stuck-job',
      async () => {
        await new Promise((r) => setTimeout(r, 3000));
        jobCompleted = true;
        resolveJobFinished();
      },
      { pollingIntervalSeconds: 0.5 },
    );

    await enqueue(boss, 'stuck-job', {});
    await new Promise((resolve) => setTimeout(resolve, 700));

    const target = new EventEmitter();
    const shutdownHandlerDone = new Promise<void>((resolve) => {
      target.once('__shutdown_done__', resolve);
    });
    registerJobsGracefulShutdown(boss, {
      target,
      timeoutMs: 1000,
      onShutdownComplete: () => target.emit('__shutdown_done__'),
    });

    const shutdownStartedAt = Date.now();
    target.emit('SIGTERM');
    await shutdownHandlerDone;
    const elapsed = Date.now() - shutdownStartedAt;

    // The configured 1000ms timeout (plus pg-boss's internal 500ms poll granularity) must
    // resolve well before the job's own 3000ms completion — proves the timeout is enforced,
    // not just a value that's accepted and ignored.
    expect(elapsed).toBeLessThan(2500);
    expect(jobCompleted).toBe(false);

    // Let the still-running handler actually finish (its own DB completion bookkeeping still
    // needs the connection) before the shared afterEach closes the PGlite client — otherwise
    // that in-flight work would race a closed connection instead of being cleanly awaited.
    await jobFinished;
  }, 10_000);
});
