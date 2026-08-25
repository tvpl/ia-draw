// concurrency-proof spec.md, CCP-05..07: BOOT-08 ("two concurrent first-run requests create at
// most one account") is proved here against a REAL Postgres — `pg.Pool` +
// `drizzle-orm/node-postgres`, not PGlite. PGlite is a single embedded connection: two
// `Promise.all`-fired calls against it never race for the same advisory lock, they only
// interleave cooperatively (docs/adr/0007-*.md's second Emenda). `bootstrapInstance`'s
// `pg_advisory_xact_lock` (firstRun.ts) is what actually serializes the two POSTs below — this
// test proves that lock holds under genuine concurrent connections, not just that the guard's
// logic is correct in isolation.
//
// Real HTTP (`app.listen` + `fetch`), and the race repeated internally rather than measured
// once. The Verifier for this feature found that a single-shot `app.inject()` measurement
// caught only 13/24 (54%) of a mutation deleting `pg_advisory_xact_lock` entirely:
// `bootstrapInstance` calls `argon2.hash(...)` — an expensive, yielding async op — BEFORE the
// lock, so the outcome of any ONE race between two concurrent first-run attempts is inherently
// close to a coin flip when the lock is absent (sometimes the two attempts' pre-lock work
// happens to overlap enough that both would proceed, sometimes it happens not to). Switching to
// real sockets plus a single discarded warm-up cycle did not reliably fix this by itself.
// Chasing a deterministic single-shot proof of an inherently probabilistic race is the wrong
// target. What `validate.md`'s own suggested mitigation calls for, and what actually works:
// repeat the race N times, resetting `users` to empty between attempts via
// `TRUNCATE ... CASCADE`, and require EVERY attempt to resolve to exactly one 201/one 409. With
// a ~50% per-attempt kill probability, missing a real lock deletion across 15 attempts has
// roughly a 1-in-33,000 chance — reliable enough to trust as a standing regression guard.
// `/auth/first-run` also carries its own per-IP rate limit (`FIRST_RUN_RATE_LIMIT`, 10
// requests/60s in routes.ts) — 15 repetitions at 2 requests each would trip it on one long-lived
// app, so the repetitions run in small batches, each against a freshly built app (a fresh
// `InMemoryRateLimiter`), while the underlying `pool`/`db` connection stays warm across every
// batch — no wall-clock wait needed.
import { randomUUID } from 'node:crypto';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as runMigrations } from 'drizzle-orm/node-postgres/migrator';
import type { FastifyInstance } from 'fastify';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../core/config.js';
import { buildServer } from '../../core/server.js';
import { registerAuthModule } from './routes.js';

/** CCP-05 edge case: fails loud and early, before ever attempting a connection. */
function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'firstRun.concurrency.int.spec.ts requires DATABASE_URL to point at a real, reachable ' +
        'Postgres — PGlite is a single embedded connection and cannot exercise genuine ' +
        'concurrent-connection races (see docs/adr/0007-*.md). Set DATABASE_URL and re-run ' +
        '`make test-integration-concurrency`.',
    );
  }
  return url;
}

/** Points at the same cluster's always-present `postgres` maintenance database, for CREATE/DROP DATABASE. */
function toAdminUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = '/postgres';
  return url.toString();
}

function toDatabaseUrl(databaseUrl: string, databaseName: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

describe('BOOT-08 under real Postgres concurrency (concurrency-proof, CCP-05..07)', () => {
  let adminUrl: string;
  let scratchDatabaseName: string;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;

  beforeAll(async () => {
    const databaseUrl = requireDatabaseUrl();
    adminUrl = toAdminUrl(databaseUrl);
    // Edge case (spec.md): BOOT-08 depends on `users` starting empty — this suite creates its
    // own isolated scratch database per run (freshly migrated, so `users` is genuinely empty)
    // and drops it afterward, never assuming or requiring the shared cluster's own database to
    // be empty.
    scratchDatabaseName = `ccp_firstrun_${randomUUID().replace(/-/g, '')}`;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${scratchDatabaseName}"`);
    } finally {
      await admin.end();
    }

    pool = new Pool({ connectionString: toDatabaseUrl(databaseUrl, scratchDatabaseName) });
    db = drizzle(pool, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });
  });

  afterAll(async () => {
    // CCP-05 edge case: when requireDatabaseUrl() threw in beforeAll, none of the below were
    // ever assigned — cleanup is a no-op rather than a second, noisier error masking the first.
    if (!adminUrl) return;
    await pool.end();

    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${scratchDatabaseName}"`);
    } finally {
      await admin.end();
    }
  });

  /** Total repetitions of the race, and how many run against one app before rotating to a fresh one — see the file header. */
  const RACE_REPETITIONS = 15;
  const RACES_PER_APP = 4;

  /** Fires two concurrent `POST /auth/first-run` over a real socket. */
  async function runFirstRunRace(
    baseUrl: string,
    label: string,
  ): Promise<{ statuses: [number, number]; userCount: number }> {
    const [responseA, responseB] = await Promise.all([
      fetch(`${baseUrl}/auth/first-run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: `ccp-first-a-${label}@example.com`,
          displayName: 'CCP First A',
          password: 'ccp-first-run-password-a',
          workspaceName: `CCP First Workspace A ${label}`,
        }),
      }),
      fetch(`${baseUrl}/auth/first-run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: `ccp-first-b-${label}@example.com`,
          displayName: 'CCP First B',
          password: 'ccp-first-run-password-b',
          workspaceName: `CCP First Workspace B ${label}`,
        }),
      }),
    ]);

    const rows = await db.select({ id: schema.users.id }).from(schema.users);
    return { statuses: [responseA.status, responseB.status], userCount: rows.length };
  }

  it(`${RACE_REPETITIONS} repeated races, each two concurrent POST /auth/first-run against an empty users table, EVERY one resolves to exactly one 201 and one 409, leaving exactly one row in users (CCP-05..07)`, async () => {
    let attempt = 0;
    while (attempt < RACE_REPETITIONS) {
      const config = loadConfig({ NODE_ENV: 'test' });
      const app: FastifyInstance = buildServer(config);
      await registerAuthModule(app, { db, config });
      await app.listen({ port: 0, host: '127.0.0.1' });
      const address = app.server.address();
      if (!address || typeof address === 'string') throw new Error('server has no address');
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const batchEnd = Math.min(attempt + RACES_PER_APP, RACE_REPETITIONS);
        for (; attempt < batchEnd; attempt += 1) {
          // `users` starts empty from migration on attempt 0; TRUNCATE resets it back to empty
          // before every later attempt, without tearing down the pool/db connection.
          if (attempt > 0) {
            await db.execute(
              sql`truncate table users, organizations, workspaces restart identity cascade`,
            );
          }

          const { statuses, userCount } = await runFirstRunRace(baseUrl, `attempt-${attempt}`);

          // CCP-06: exactly one 201 (the winner) and one 409 (the loser, blocked by
          // firstRun.ts's InstanceAlreadyInitializedError once the winner's account already
          // committed) — on EVERY attempt, not just one measured sample (see file header).
          expect(
            [...statuses].sort((a, b) => a - b),
            `attempt ${attempt}`,
          ).toEqual([201, 409]);

          // CCP-07: the database itself, not the HTTP responses, is the source of truth for
          // what actually persisted.
          expect(userCount, `attempt ${attempt}`).toBe(1);
        }
      } finally {
        await app.close();
      }
    }
  });
});
