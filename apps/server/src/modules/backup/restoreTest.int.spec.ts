// SPEC_DEVIATION / honesty note (T90, DR-02) — same discipline as T89
// (`infra/backup/src/incremental.int.spec.ts`): the checksum-detection and
// real-restore scenarios below run against 2 GENUINELY SEPARATE real
// Postgres 16 SERVER PROCESSES (never PGlite, never a mock) — this
// sandbox's pre-existing `main` cluster (port 5432, the SOURCE/"production"
// stand-in for the isolation guard) and an idempotently-provisioned second
// real cluster (port 5433, the ISOLATED restore-test TARGET), reusing the
// exact `pg_createcluster`/`pg_ctlcluster` provisioning T89 already proved
// works in this sandbox. `db` (the app's OWN operational database that
// receives the resulting `audit_events` row) uses PGlite — a real, embedded
// Postgres-compatible engine (AD-007) — since audit-event writes don't need
// real `psql`/COPY, only a real Postgres-compatible SQL engine with the
// app's schema migrated; this mirrors the rest of this codebase's own
// convention (e.g. `webhook/deliver.int.spec.ts`) of using PGlite for
// schema-bearing app-state assertions while reserving real Postgres
// clusters for what genuinely needs real `pg_dump`/`psql` binaries. Object
// storage uses the same in-memory fake `create.int.spec.ts`/
// `incremental.int.spec.ts` already establish (no real MinIO in this
// sandbox) — irrelevant here since every backup below captures zero
// buckets (`buckets: []`), so the object-store boundary is never actually
// exercised (only `dump.sql`). `afterAll` stops the second cluster and
// drops every scratch database this file created on both, same as T89.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  type BackupObjectStore,
  createBackup,
  restoreDatabase as restoreDatabaseReal,
} from '@arch-canvas/backup';
import * as schema from '@arch-canvas/database';
import { auditEvents, MIGRATIONS_FOLDER, migrate } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runPgliteMigrations } from 'drizzle-orm/pglite/migrator';
import JSZip from 'jszip';
import { Pool } from 'pg';
import { fromPglite } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../core/config.js';
import { enqueue, type JobQueue, startJobs } from '../jobs/index.js';
import {
  DEFAULT_RESTORE_TEST_CRON,
  RESTORE_TEST_JOB,
  registerRestoreTestJob,
  runRestoreTest,
} from './restoreTest.js';

const SECOND_CLUSTER_NAME = 'restoretest';
const SECOND_CLUSTER_PORT = 5434;
const MAIN_CLUSTER_PORT = 5432;
const POSTGRES_PASSWORD = 'dev-insecure-secret-change-me';

function sh(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: 'utf8' });
}

function ensureTwoRealPostgresInstances(): void {
  let listing = sh('pg_lsclusters', []);
  if (!listing.includes(SECOND_CLUSTER_NAME)) {
    sh('pg_createcluster', ['16', SECOND_CLUSTER_NAME, '-p', String(SECOND_CLUSTER_PORT)]);
    listing = sh('pg_lsclusters', []);
  }
  const secondLine = listing.split('\n').find((line) => line.includes(SECOND_CLUSTER_NAME));
  if (secondLine?.includes(' down ')) {
    sh('pg_ctlcluster', ['16', SECOND_CLUSTER_NAME, 'start']);
  }
  const mainLine = listing.split('\n').find((line) => / main /.test(line));
  if (mainLine?.includes(' down ')) {
    sh('pg_ctlcluster', ['16', 'main', 'start']);
  }

  sh('sudo', [
    '-u',
    'postgres',
    'psql',
    '-p',
    String(MAIN_CLUSTER_PORT),
    '-c',
    `ALTER USER postgres PASSWORD '${POSTGRES_PASSWORD}';`,
  ]);
  sh('sudo', [
    '-u',
    'postgres',
    'psql',
    '-p',
    String(SECOND_CLUSTER_PORT),
    '-c',
    `ALTER USER postgres PASSWORD '${POSTGRES_PASSWORD}';`,
  ]);
}

function createScratchDatabase(port: number, name: string): void {
  sh('sudo', ['-u', 'postgres', 'createdb', '-p', String(port), name]);
}

function dropScratchDatabase(port: number, name: string): void {
  try {
    sh('sudo', ['-u', 'postgres', 'dropdb', '-p', String(port), '--if-exists', name]);
  } catch {
    // best-effort cleanup
  }
}

function databaseUrl(port: number, name: string): string {
  return `postgres://postgres:${POSTGRES_PASSWORD}@127.0.0.1:${port}/${name}`;
}

function createFakeObjectStore(): BackupObjectStore {
  return {
    async listObjects() {
      return [];
    },
    async getObject(bucket, key) {
      throw new Error(`unexpected getObject(${bucket}, ${key}) — no bucket captured in this test`);
    },
    async putObject(bucket, key) {
      throw new Error(`unexpected putObject(${bucket}, ${key}) — no bucket captured in this test`);
    },
  };
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline)
      throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('recurring automated restore-test job (T90, DR-02) — 2 real Postgres 16 instances', () => {
  const sourceDbName = `restoretest_src_${randomUUID().replaceAll('-', '_')}`;
  const targetDbName = `restoretest_tgt_${randomUUID().replaceAll('-', '_')}`;
  const negativeTargetDbName = `restoretest_neg_${randomUUID().replaceAll('-', '_')}`;
  const sourceUrl = databaseUrl(MAIN_CLUSTER_PORT, sourceDbName);

  let sourcePool: Pool;
  let sourceDb: NodePgDatabase<typeof schema>;
  let appDbClient: PGlite;
  let appDb: PgliteDatabase<typeof schema>;

  beforeAll(async () => {
    ensureTwoRealPostgresInstances();
    createScratchDatabase(MAIN_CLUSTER_PORT, sourceDbName);

    await migrate(sourceUrl);
    sourcePool = new Pool({ connectionString: sourceUrl });
    sourceDb = drizzleNodePg(sourcePool, { schema });

    const [org] = await sourceDb
      .insert(schema.organizations)
      .values({ name: 'Restore Test Org', slug: `restoretest-org-${randomUUID()}` })
      .returning();
    if (!org) throw new Error('organization insert failed');
    const [workspace] = await sourceDb
      .insert(schema.workspaces)
      .values({
        organizationId: org.id,
        name: 'Restore Test WS',
        slug: `restoretest-ws-${randomUUID()}`,
      })
      .returning();
    if (!workspace) throw new Error('workspace insert failed');
    const [user] = await sourceDb
      .insert(schema.users)
      .values({ email: `restoretest-owner-${randomUUID()}@example.com`, displayName: 'RT Owner' })
      .returning();
    if (!user) throw new Error('user insert failed');
    await sourceDb.insert(schema.projects).values({
      workspaceId: workspace.id,
      name: 'RT Project',
      ownerId: user.id,
    });

    appDbClient = new PGlite();
    appDb = drizzlePglite(appDbClient, { schema });
    await runPgliteMigrations(appDb, { migrationsFolder: MIGRATIONS_FOLDER });
  }, 120_000);

  afterAll(async () => {
    await sourcePool?.end();
    await appDbClient?.close();
    dropScratchDatabase(MAIN_CLUSTER_PORT, sourceDbName);
    dropScratchDatabase(SECOND_CLUSTER_PORT, targetDbName);
    dropScratchDatabase(SECOND_CLUSTER_PORT, negativeTargetDbName);
    try {
      sh('pg_ctlcluster', ['16', SECOND_CLUSTER_NAME, 'stop']);
    } catch {
      // best-effort
    }
  }, 60_000);

  it('a clean backup restores into an isolated target, checksums AND row counts both match — success audit event recorded', async () => {
    const targetUrl = databaseUrl(SECOND_CLUSTER_PORT, targetDbName);
    createScratchDatabase(SECOND_CLUSTER_PORT, targetDbName);

    const objectStore = createFakeObjectStore();
    const outputPath = `/tmp/restore-test-clean-${randomUUID()}.zip`;
    await createBackup({ databaseUrl: sourceUrl, objectStore, outputPath, buckets: [] });

    const outcome = await runRestoreTest({
      db: appDb,
      backupPath: outputPath,
      objectStore,
      targetDatabaseUrl: targetUrl,
      productionDatabaseUrl: sourceUrl,
    });

    expect(outcome.outcome).toBe('success');
    expect(outcome.checksumMismatches).toEqual([]);
    expect(outcome.rowCountMismatches).toEqual([]);

    const events = await appDb
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'backup.restore_test.succeeded'));
    expect(events).toHaveLength(1);
    const successEvent = events[0];
    if (!successEvent) throw new Error('expected a success audit event row');
    const successMetadata = successEvent.metadataJson as { backupPath: string; severity: string };
    expect(successMetadata.backupPath).toBe(outputPath);
    expect(successMetadata.severity).toBe('info');

    // Genuinely restored — the workspace row landed in the isolated target.
    const targetPool = new Pool({ connectionString: targetUrl });
    try {
      const result = await targetPool.query('SELECT count(*)::int AS count FROM workspaces;');
      expect(result.rows[0]?.count).toBeGreaterThan(0);
    } finally {
      await targetPool.end();
    }
  }, 120_000);

  it('a deliberately tampered backup is caught by checksum verification BEFORE the isolated target is ever touched — failure audit event, high severity, never a silent success', async () => {
    const objectStore = createFakeObjectStore();
    const outputPath = `/tmp/restore-test-tampered-${randomUUID()}.zip`;
    await createBackup({ databaseUrl: sourceUrl, objectStore, outputPath, buckets: [] });

    // Same tamper-detection scenario F1c's create.int.spec.ts/T89's
    // incremental.int.spec.ts already exercise: mutate a file's bytes
    // inside the archive without updating manifest.json's recorded
    // checksum.
    const original = readFileSync(outputPath);
    const zip = await JSZip.loadAsync(original);
    const dumpSql = await zip.file('dump.sql')?.async('string');
    zip.file('dump.sql', `${dumpSql}\n-- tampered by T90 restore-test corruption scenario`);
    writeFileSync(outputPath, await zip.generateAsync({ type: 'nodebuffer' }));

    const negativeTargetUrl = databaseUrl(SECOND_CLUSTER_PORT, negativeTargetDbName);
    createScratchDatabase(SECOND_CLUSTER_PORT, negativeTargetDbName);

    const outcome = await runRestoreTest({
      db: appDb,
      backupPath: outputPath,
      objectStore,
      targetDatabaseUrl: negativeTargetUrl,
      productionDatabaseUrl: sourceUrl,
    });

    expect(outcome.outcome).toBe('failure');
    expect(outcome.checksumMismatches.length).toBeGreaterThan(0);

    const events = await appDb
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'backup.restore_test.failed'));
    expect(events).toHaveLength(1);
    const failureEvent = events[0];
    if (!failureEvent) throw new Error('expected a failure audit event row');
    const failureMetadata = failureEvent.metadataJson as {
      severity: string;
      checksumMismatches: string[];
    };
    expect(failureMetadata.severity).toBe('high');
    expect(failureMetadata.checksumMismatches.length).toBeGreaterThan(0);

    // The isolated target was NEVER touched — proves this is a genuine
    // refusal-before-restore, not a partial-then-caught-error.
    const negativePool = new Pool({ connectionString: negativeTargetUrl });
    try {
      const result = await negativePool.query(
        `SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      expect(result.rows[0]?.count).toBe(0);
    } finally {
      await negativePool.end();
    }
  }, 120_000);

  it('a restore that silently applies less than the dump content diverges on row count — checksum-valid but semantically wrong, caught by the SEPARATE row-count cross-check', async () => {
    const objectStore = createFakeObjectStore();
    const outputPath = `/tmp/restore-test-shortrestore-${randomUUID()}.zip`;
    await createBackup({ databaseUrl: sourceUrl, objectStore, outputPath, buckets: [] });

    const truncatedTargetDbName = `restoretest_trunc_${randomUUID().replaceAll('-', '_')}`;
    const truncatedTargetUrl = databaseUrl(SECOND_CLUSTER_PORT, truncatedTargetDbName);
    createScratchDatabase(SECOND_CLUSTER_PORT, truncatedTargetDbName);

    // A restore implementation that (deliberately, for this test only)
    // drops ONE data row of `drizzle.__drizzle_migrations`'s COPY block
    // before applying — the archive itself is untouched/unmodified
    // (checksum verification against the real, unmodified archive passes
    // cleanly), simulating a restore-path bug or a target that silently
    // lost a row — exactly the class of divergence checksum verification
    // (which never touches the restore target) cannot see on its own.
    // Targets drizzle-kit's own internal migrations-bookkeeping table
    // specifically — it always has several rows (one per applied
    // migration) and, unlike `workspaces`/`projects`/etc., has no
    // foreign-key relationships to anything else in the dump, so dropping
    // one row here can never cascade into an unrelated FK violation that
    // would make `restoreDatabaseReal` itself throw before the row-count
    // check is ever reached.
    async function dropOneMigrationRowThenRestore(databaseUrl: string, sql: string): Promise<void> {
      const lines = sql.split('\n');
      const copyStart = lines.findIndex((line) =>
        /^COPY\s+(?:[A-Za-z0-9_]+\.)?"?__drizzle_migrations"?\s*\(/.test(line),
      );
      if (copyStart === -1) {
        throw new Error('test setup error: no COPY block found for "__drizzle_migrations"');
      }
      const copyEnd = lines.findIndex((line, i) => i > copyStart && line === '\\.');
      if (copyEnd === -1 || copyEnd - copyStart <= 1) {
        throw new Error(
          'test setup error: "__drizzle_migrations" COPY block has no data row to drop',
        );
      }
      lines.splice(copyEnd - 1, 1); // drop the last data line before `\.`
      restoreDatabaseReal(databaseUrl, lines.join('\n'));
    }

    const outcome = await runRestoreTest({
      db: appDb,
      backupPath: outputPath,
      objectStore,
      targetDatabaseUrl: truncatedTargetUrl,
      productionDatabaseUrl: sourceUrl,
      restore: dropOneMigrationRowThenRestore,
    });

    expect(outcome.outcome).toBe('failure');
    expect(outcome.checksumMismatches).toEqual([]); // the archive itself was never tampered
    expect(outcome.rowCountMismatches.length).toBeGreaterThan(0);
    const firstMismatch = outcome.rowCountMismatches[0];
    if (!firstMismatch) throw new Error('expected a row-count mismatch entry');
    expect(firstMismatch.actual).toBeLessThan(firstMismatch.expected);

    const events = await appDb
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'backup.restore_test.failed'));
    const rowDivergenceEvent = events.find(
      (event) =>
        (event.metadataJson as { reason?: string }).reason ===
        'row counts diverge from the backup dump content after restore',
    );
    if (!rowDivergenceEvent) throw new Error('expected a row-divergence failure audit event');
    const rowDivergenceMetadata = rowDivergenceEvent.metadataJson as { severity: string };
    expect(rowDivergenceMetadata.severity).toBe('high');

    dropScratchDatabase(SECOND_CLUSTER_PORT, truncatedTargetDbName);
  }, 120_000);

  it('assertIsolatedRestoreTarget guard fires end-to-end: targetDatabaseUrl === productionDatabaseUrl throws BEFORE any verify/restore/audit-write happens', async () => {
    const objectStore = createFakeObjectStore();
    const outputPath = `/tmp/restore-test-guard-${randomUUID()}.zip`;
    await createBackup({ databaseUrl: sourceUrl, objectStore, outputPath, buckets: [] });

    const eventsBefore = await appDb.select().from(auditEvents);

    await expect(
      runRestoreTest({
        db: appDb,
        backupPath: outputPath,
        objectStore,
        targetDatabaseUrl: sourceUrl,
        productionDatabaseUrl: sourceUrl,
      }),
    ).rejects.toThrow(/refusing to run a restore test against a live\/production database/);

    const eventsAfter = await appDb.select().from(auditEvents);
    expect(eventsAfter).toHaveLength(eventsBefore.length); // zero audit events written by the rejected call
  }, 60_000);

  it('registerRestoreTestJob schedules a real recurring pg-boss job, and firing it end-to-end runs a genuine restore test producing an audit event', async () => {
    const bossClient = new PGlite();
    let boss: JobQueue | undefined;
    try {
      boss = await startJobs(loadConfig({ NODE_ENV: 'test' }), {
        db: fromPglite(bossClient),
        backend: 'pglite',
      });

      const jobTargetDbName = `restoretest_jobtgt_${randomUUID().replaceAll('-', '_')}`;
      const jobTargetUrl = databaseUrl(SECOND_CLUSTER_PORT, jobTargetDbName);
      createScratchDatabase(SECOND_CLUSTER_PORT, jobTargetDbName);

      const objectStore = createFakeObjectStore();
      const outputPath = `/tmp/restore-test-job-${randomUUID()}.zip`;
      await createBackup({ databaseUrl: sourceUrl, objectStore, outputPath, buckets: [] });

      await registerRestoreTestJob(boss, appDb, {
        targetDatabaseUrl: jobTargetUrl,
        productionDatabaseUrl: sourceUrl,
        objectStore,
        getLatestBackupPath: () => outputPath,
        cron: '30 4 * * *',
      });

      const schedules = await boss.getSchedules(RESTORE_TEST_JOB);
      expect(schedules).toHaveLength(1);
      expect(schedules[0]?.cron).toBe('30 4 * * *');
      expect(DEFAULT_RESTORE_TEST_CRON).toBe('0 3 * * *'); // sanity: default differs from this test's override

      const eventsBefore = await appDb.select().from(auditEvents);

      // Fire the job's underlying queue directly (proves defineJob's
      // handler is wired to a real runRestoreTest call) rather than
      // waiting on the cron tick's up-to-60s real-clock delay.
      await enqueue(boss, RESTORE_TEST_JOB, {});

      await waitUntil(async () => {
        const events = await appDb.select().from(auditEvents);
        return events.length > eventsBefore.length;
      }, 15_000);

      const eventsAfter = await appDb.select().from(auditEvents);
      const newEvent = eventsAfter[eventsAfter.length - 1];
      expect(newEvent?.action).toBe('backup.restore_test.succeeded');

      dropScratchDatabase(SECOND_CLUSTER_PORT, jobTargetDbName);
    } finally {
      if (boss) await boss.stop({ graceful: false, timeout: 1000 });
      await bossClient.close();
    }
  }, 60_000);
});
