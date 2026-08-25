// concurrency-proof spec.md, CCP-05..07: BOOT-08 ("two concurrent first-run requests create at
// most one account") is proved here against a REAL Postgres — `pg.Pool` +
// `drizzle-orm/node-postgres`, not PGlite. PGlite is a single embedded connection: two
// `Promise.all`-fired calls against it never race for the same advisory lock, they only
// interleave cooperatively (docs/adr/0007-*.md's second Emenda). `bootstrapInstance`'s
// `pg_advisory_xact_lock` (firstRun.ts) is what actually serializes the two POSTs below — this
// test proves that lock holds under genuine concurrent connections, not just that the guard's
// logic is correct in isolation.
import { randomUUID } from 'node:crypto';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
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
  let app: FastifyInstance;

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

    const config = loadConfig({ NODE_ENV: 'test' });
    app = buildServer(config);
    await registerAuthModule(app, { db, config });
    await app.ready();
  });

  afterAll(async () => {
    // CCP-05 edge case: when requireDatabaseUrl() threw in beforeAll, none of the below were
    // ever assigned — cleanup is a no-op rather than a second, noisier error masking the first.
    if (!adminUrl) return;
    await app.close();
    await pool.end();

    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${scratchDatabaseName}"`);
    } finally {
      await admin.end();
    }
  });

  it('two concurrent POST /auth/first-run with different bodies, against an empty users table, resolve to exactly one 201 and one 409, leaving exactly one row in users (CCP-05..07)', async () => {
    // CCP-05: fired via Promise.all — real concurrent connections, not sequential awaits. Real
    // Postgres's `pg_advisory_xact_lock` in bootstrapInstance decides the outcome, not
    // Promise.all's call order.
    const [responseA, responseB] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/auth/first-run',
        payload: {
          email: 'ccp-first-a@example.com',
          displayName: 'CCP First A',
          password: 'ccp-first-run-password-a',
          workspaceName: 'CCP First Workspace A',
        },
      }),
      app.inject({
        method: 'POST',
        url: '/auth/first-run',
        payload: {
          email: 'ccp-first-b@example.com',
          displayName: 'CCP First B',
          password: 'ccp-first-run-password-b',
          workspaceName: 'CCP First Workspace B',
        },
      }),
    ]);

    // CCP-06: exactly one 201 (the winner) and one 409 (the loser, blocked by firstRun.ts's
    // InstanceAlreadyInitializedError once the winner's account already committed).
    const statuses = [responseA.statusCode, responseB.statusCode].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    // CCP-07: the database itself, not the HTTP responses, is the source of truth for what
    // actually persisted.
    const rows = await db.select({ id: schema.users.id }).from(schema.users);
    expect(rows).toHaveLength(1);
  });
});
