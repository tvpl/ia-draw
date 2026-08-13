import { type ConstructorOptions, PgBoss, type SendOptions, type WorkOptions } from 'pg-boss';
import type { AppConfig } from '../../core/config.js';

export type JobQueue = PgBoss;

export type JobHandler<TPayload extends object> = (payload: TPayload) => Promise<void>;

/**
 * Starts pg-boss (AD-006 — jobs over PostgreSQL, no Redis) over the app's
 * own Postgres connection. `overrides` lets callers swap in a different
 * `db`/`backend` (integration tests use pg-boss's own `fromPglite` adapter
 * + `backend: 'pglite'`, a real embedded Postgres engine — not a mock, see
 * queue.int.spec.ts).
 */
export async function startJobs(
  config: AppConfig,
  overrides: Partial<ConstructorOptions> = {},
): Promise<JobQueue> {
  const boss = new PgBoss({
    connectionString: config.databaseUrl,
    ...overrides,
  });

  // pg-boss re-throws unhandled 'error' events if nothing is listening — an
  // explicit listener (its own documented pattern) keeps background failures
  // (e.g. a maintenance query) from crashing the process.
  boss.on('error', (error) => {
    console.error('[jobs] pg-boss error', error);
  });

  await boss.start();
  return boss;
}

/** Registers `handler` for jobs sent to `name`'s queue, creating the queue first if it doesn't exist. */
export async function defineJob<TPayload extends object>(
  boss: JobQueue,
  name: string,
  handler: JobHandler<TPayload>,
  workOptions: WorkOptions = {},
): Promise<void> {
  await boss.createQueue(name);
  await boss.work<TPayload>(name, workOptions, async (jobs) => {
    for (const job of jobs) {
      await handler(job.data);
    }
  });
}

/**
 * Enqueues `payload` onto `name`'s queue, returning the created job id (or
 * `null` if deduped/throttled). `options` is pg-boss's own `SendOptions` —
 * `startAfter` (a `Date`/ISO string/seconds delay) is how the webhook
 * delivery pipeline (T80) schedules a retry at `nextRetryAt` by re-sending
 * the SAME job rather than building a separate polling worker (AD-006:
 * jobs stay on pg-boss over Postgres, no bespoke scheduler).
 */
export async function enqueue<TPayload extends object>(
  boss: JobQueue,
  name: string,
  payload: TPayload,
  options?: SendOptions,
): Promise<string | null> {
  return options ? boss.send(name, payload, options) : boss.send(name, payload);
}
