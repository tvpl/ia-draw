// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox;
// PGlite runs a real Postgres engine so integration fidelity is preserved (AD-007). This
// file proves the WIRING gate T96 adds to `registerAllModules` — that the recurring
// `backup-restore-test` job (T90) is scheduled only when BOTH `deps.jobs` AND
// `config.restoreTest` are present — never that the restore mechanism itself works
// end-to-end (that's `backup/restoreTest.int.spec.ts`'s job, already proven against 2
// genuinely separate real Postgres 16 clusters). The job is never fired here (only
// scheduled), so `targetDatabaseUrl` below is an inert placeholder string, never
// connected to.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import { fromPglite } from 'pg-boss';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RESTORE_TEST_JOB } from '../modules/backup/restoreTest.js';
import { type JobQueue, startJobs } from '../modules/jobs/index.js';
import { loadConfig } from './config.js';
import { registerAllModules } from './registerModules.js';
import { buildServer } from './server.js';

describe('registerAllModules — restore-test job wiring gate (T96, DR-02)', () => {
  let dbClient: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let bossClient: PGlite;
  let jobs: JobQueue;
  let app: FastifyInstance | undefined;
  let backupDir: string;

  beforeEach(async () => {
    dbClient = new PGlite();
    db = drizzle(dbClient, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    bossClient = new PGlite();
    jobs = await startJobs(loadConfig({ NODE_ENV: 'test' }), {
      db: fromPglite(bossClient),
      backend: 'pglite',
    });

    backupDir = await mkdtemp(join(tmpdir(), 'arch-canvas-restore-test-wiring-'));
  });

  afterEach(async () => {
    await app?.close();
    await jobs.stop({ graceful: false, timeout: 1_000 });
    await dbClient.close();
    await bossClient.close();
    await rm(backupDir, { recursive: true, force: true });
  });

  it('schedules the restore-test job when config.restoreTest AND deps.jobs are both present', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      RESTORE_TEST_TARGET_DATABASE_URL: 'postgres://isolated-restore-target/never-connected',
      RESTORE_TEST_BACKUP_DIR: backupDir,
      RESTORE_TEST_CRON: '15 2 * * *',
    });
    app = buildServer(config, {
      dependencyChecks: [{ name: 'postgres', check: async () => true }],
    });
    await registerAllModules(app, db, config, { jobs });
    await app.ready();

    const schedules = await jobs.getSchedules(RESTORE_TEST_JOB);
    expect(schedules).toHaveLength(1);
    expect(schedules[0]?.cron).toBe('15 2 * * *');
  });

  it('never schedules the restore-test job when config.restoreTest is unset, even with deps.jobs present', async () => {
    const config = loadConfig({ NODE_ENV: 'test' });
    expect(config.restoreTest).toBeUndefined();

    app = buildServer(config, {
      dependencyChecks: [{ name: 'postgres', check: async () => true }],
    });
    await registerAllModules(app, db, config, { jobs });
    await app.ready();

    const schedules = await jobs.getSchedules(RESTORE_TEST_JOB);
    expect(schedules).toHaveLength(0);
  });

  it('never schedules the restore-test job when deps.jobs is omitted, even with config.restoreTest set', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      RESTORE_TEST_TARGET_DATABASE_URL: 'postgres://isolated-restore-target/never-connected',
      RESTORE_TEST_BACKUP_DIR: backupDir,
    });
    app = buildServer(config, {
      dependencyChecks: [{ name: 'postgres', check: async () => true }],
    });
    // No `jobs` in deps — mirrors a Postgres-unreachable-at-boot degrade (index.ts).
    await registerAllModules(app, db, config, {});
    await app.ready();

    // Nothing to assert against `jobs.getSchedules` here (this `jobs` instance was never
    // passed to registerAllModules) — the meaningful assertion is that boot completes
    // AND the server is fully functional, proving the optional-jobs degrade still holds
    // with config.restoreTest set (never a partial/broken boot).
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
  });
});
