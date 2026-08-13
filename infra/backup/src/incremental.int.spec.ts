// SPEC_DEVIATION / honesty note (T89, DR-01) — stronger infra than F1c's own
// `create.int.spec.ts` needed: this test reproduces the FULL incremental
// backup chain against 2 GENUINELY SEPARATE real Postgres 16 SERVER
// PROCESSES, never PGlite and never a mock. This sandbox ships the
// `postgresql-common` cluster tools (`pg_lsclusters`/`pg_createcluster`/
// `pg_ctlcluster`, confirmed present) and runs as root, so `beforeAll`
// below defensively (idempotently) ensures a real SECOND Postgres 16
// cluster exists on a distinct port, alongside the sandbox's pre-existing
// `main` cluster (port 5432) — the SOURCE. The second cluster (port 5433)
// is the RESTORE TARGET. Because both are real Postgres 16 (unlike
// `create.int.spec.ts`'s PGlite target, which reports `server_version`
// 18.3 and makes real `pg_dump` refuse with a version-mismatch error), this
// test uses the REAL, non-injected `pgDump.ts`/`incremental.ts` functions
// end to end — real `pg_dump`, real `psql`-COPY, real restore. Object
// storage still uses `create.int.spec.ts`'s established in-memory fake (no
// real MinIO in this sandbox, T27's disclosed limitation — irrelevant to
// what this test is actually proving, the Postgres-side row-level
// incremental chain). `afterAll` stops (never leaves running) the second
// cluster and drops every scratch database this test created on both.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as schema from '@arch-canvas/database';
import { migrate } from '@arch-canvas/database';
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBackup } from './create.js';
import {
  createIncrementalBackup,
  INCREMENTAL_TABLES,
  IncrementalChainError,
  restoreIncrementalChain,
} from './incremental.js';
import type { BackupObjectStore } from './objectStore.js';
import { BackupVerificationError } from './restore.js';

const SECOND_CLUSTER_NAME = 'backuptest';
const SECOND_CLUSTER_PORT = 5433;
const MAIN_CLUSTER_PORT = 5432;
/** Same documented dev placeholder (`INSECURE_DEV_SECRET`) used everywhere else in this repo — test-only scratch clusters, never a production credential. */
const POSTGRES_PASSWORD = 'dev-insecure-secret-change-me';

function sh(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: 'utf8' });
}

/** Idempotent: creates the second real Postgres 16 cluster if it doesn't exist yet, starts it if stopped, and ensures a known password on BOTH clusters' `postgres` role (peer-auth admin actions via `sudo -u postgres`, exactly like the manual validation `tasks-f1c.md`'s T34 Status note already documents doing in this same sandbox). */
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

function createFakeObjectStore(): BackupObjectStore & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    async listObjects(bucket) {
      const prefix = `${bucket}/`;
      return [...objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
    },
    async getObject(bucket, key) {
      const bytes = objects.get(`${bucket}/${key}`);
      if (!bytes) throw new Error(`object ${bucket}/${key} not found`);
      return bytes;
    },
    async putObject(bucket, key, body) {
      objects.set(`${bucket}/${key}`, body);
    },
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('incremental backup chained to a full-backup baseline (T89, DR-01) — 2 real Postgres 16 instances', () => {
  const sourceDbName = `backup_incr_src_${randomUUID().replaceAll('-', '_')}`;
  const targetDbName = `backup_incr_tgt_${randomUUID().replaceAll('-', '_')}`;
  const negativeTargetDbName = `backup_incr_neg_${randomUUID().replaceAll('-', '_')}`;
  const sourceUrl = databaseUrl(MAIN_CLUSTER_PORT, sourceDbName);
  const targetUrl = databaseUrl(SECOND_CLUSTER_PORT, targetDbName);
  const negativeTargetUrl = databaseUrl(SECOND_CLUSTER_PORT, negativeTargetDbName);

  let sourcePool: Pool;
  let sourceDb: NodePgDatabase<typeof schema>;
  let workspaceId: string;
  let diagramId: string;
  let userId: string;

  const backupPaths = {
    full: '',
    inc1: '',
    inc2: '',
  };

  beforeAll(async () => {
    ensureTwoRealPostgresInstances();
    createScratchDatabase(MAIN_CLUSTER_PORT, sourceDbName);
    createScratchDatabase(SECOND_CLUSTER_PORT, targetDbName);
    createScratchDatabase(SECOND_CLUSTER_PORT, negativeTargetDbName);

    await migrate(sourceUrl);
    // Target databases are intentionally left schema-less — `backup:restore`'s
    // dump.sql (real pg_dump output) creates the schema itself, matching
    // `create.int.spec.ts`'s "against a fresh, empty target" convention.

    sourcePool = new Pool({ connectionString: sourceUrl });
    sourceDb = drizzle(sourcePool, { schema });

    const [org] = await sourceDb
      .insert(schema.organizations)
      .values({ name: 'Incremental Backup Org', slug: `incr-org-${randomUUID()}` })
      .returning();
    if (!org) throw new Error('organization insert failed');
    const [workspace] = await sourceDb
      .insert(schema.workspaces)
      .values({
        organizationId: org.id,
        name: 'Incremental Backup WS',
        slug: `incr-ws-${randomUUID()}`,
      })
      .returning();
    if (!workspace) throw new Error('workspace insert failed');
    workspaceId = workspace.id;

    const [user] = await sourceDb
      .insert(schema.users)
      .values({ email: `incr-owner-${randomUUID()}@example.com`, displayName: 'Incr Owner' })
      .returning();
    if (!user) throw new Error('user insert failed');
    userId = user.id;

    const [project] = await sourceDb
      .insert(schema.projects)
      .values({ workspaceId, name: 'Incr Project', ownerId: userId })
      .returning();
    if (!project) throw new Error('project insert failed');

    const [diagram] = await sourceDb
      .insert(schema.diagrams)
      .values({ projectId: project.id, title: 'Incr Diagram', ownerId: userId })
      .returning();
    if (!diagram) throw new Error('diagram insert failed');
    diagramId = diagram.id;
  }, 120_000);

  afterAll(async () => {
    await sourcePool?.end();
    dropScratchDatabase(MAIN_CLUSTER_PORT, sourceDbName);
    dropScratchDatabase(SECOND_CLUSTER_PORT, targetDbName);
    dropScratchDatabase(SECOND_CLUSTER_PORT, negativeTargetDbName);
    // Process cleanup — never leave a spawned Postgres instance running
    // beyond this test file (matches this batch's operating discipline for
    // real-Redis/real-oidc-provider spawned test infra).
    try {
      sh('pg_ctlcluster', ['16', SECOND_CLUSTER_NAME, 'stop']);
    } catch {
      // best-effort
    }
  }, 60_000);

  async function seedOperation(summary: string) {
    await sourceDb.insert(schema.diagramOperations).values({
      diagramId,
      sequence: Math.floor(Math.random() * 1_000_000_000),
      clientMutationId: randomUUID(),
      actorId: userId,
      baseRevision: 0,
      elementsDeltaJson: [{ kind: 'noop', summary }],
      operationSummaryJson: { summary },
    });
  }

  async function seedAuditEvent(action: string) {
    await sourceDb.insert(schema.auditEvents).values({
      actorId: userId,
      action,
      resourceType: 'diagram',
      resourceId: diagramId,
      metadataJson: { note: action },
    });
  }

  async function seedSnapshot(revision: number, sceneJsonKey: string) {
    await sourceDb.insert(schema.diagramSnapshots).values({
      diagramId,
      revision,
      kind: 'named',
      sceneJsonKey,
      checksum: `checksum-${sceneJsonKey}`,
      createdBy: userId,
    });
  }

  it('full backup, then chained incremental restore reconstructs the exact same rows (OPS-style checksums included)', async () => {
    const objectStore = createFakeObjectStore();
    await objectStore.putObject(
      'exports',
      'baseline-scene.json',
      Buffer.from('baseline-scene-bytes'),
    );

    // Baseline rows — captured by the FULL backup.
    await seedOperation('baseline-op-1');
    await seedAuditEvent('diagram.viewed.baseline');
    await seedSnapshot(1, 'baseline-scene.json');

    const fullOutputPath = `/tmp/backup-full-${randomUUID()}.zip`;
    backupPaths.full = fullOutputPath;
    const fullManifest = await createBackup({
      databaseUrl: sourceUrl,
      objectStore,
      outputPath: fullOutputPath,
      buckets: ['exports'],
    });
    expect(fullManifest.type).toBe('full');

    await sleep(50);

    // Wave 2 — captured by the FIRST incremental.
    await objectStore.putObject('exports', 'wave2-scene.json', Buffer.from('wave2-scene-bytes'));
    await seedOperation('wave2-op-1');
    await seedOperation('wave2-op-2');
    await seedAuditEvent('diagram.viewed.wave2');
    await seedSnapshot(2, 'wave2-scene.json');

    const inc1OutputPath = `/tmp/backup-inc1-${randomUUID()}.zip`;
    backupPaths.inc1 = inc1OutputPath;
    const inc1Manifest = await createIncrementalBackup({
      databaseUrl: sourceUrl,
      objectStore,
      baseBackupPath: fullOutputPath,
      outputPath: inc1OutputPath,
    });
    expect(inc1Manifest.type).toBe('incremental');
    expect(inc1Manifest.tables).toEqual(INCREMENTAL_TABLES);

    await sleep(50);

    // Wave 3 — captured by the SECOND incremental, chained to the FIRST
    // incremental (not to the full backup) — the task's own explicit AC.
    await objectStore.putObject('exports', 'wave3-scene.json', Buffer.from('wave3-scene-bytes'));
    await seedOperation('wave3-op-1');
    await seedAuditEvent('diagram.viewed.wave3');
    await seedSnapshot(3, 'wave3-scene.json');

    const inc2OutputPath = `/tmp/backup-inc2-${randomUUID()}.zip`;
    backupPaths.inc2 = inc2OutputPath;
    const inc2Manifest = await createIncrementalBackup({
      databaseUrl: sourceUrl,
      objectStore,
      baseBackupPath: inc1OutputPath,
      outputPath: inc2OutputPath,
    });
    expect(inc2Manifest.baseManifestChecksum).not.toBe(inc1Manifest.baseManifestChecksum);

    // Restore the FULL chain into the second real Postgres instance.
    await restoreIncrementalChain({
      chain: [fullOutputPath, inc1OutputPath, inc2OutputPath],
      databaseUrl: targetUrl,
      objectStore,
    });

    const targetPool = new Pool({ connectionString: targetUrl });
    const targetDb = drizzle(targetPool, { schema });
    try {
      const operations = await targetDb
        .select()
        .from(schema.diagramOperations)
        .where(eq(schema.diagramOperations.diagramId, diagramId));
      const auditRows = await targetDb
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.resourceId, diagramId));
      const snapshots = await targetDb
        .select()
        .from(schema.diagramSnapshots)
        .where(eq(schema.diagramSnapshots.diagramId, diagramId))
        .orderBy(schema.diagramSnapshots.revision);

      // All 3 waves landed: 1 (baseline) + 2 (wave2) + 1 (wave3) operations.
      expect(operations).toHaveLength(4);
      // 1 + 1 + 1 audit events.
      expect(auditRows).toHaveLength(3);
      // 1 snapshot per wave, revisions 1/2/3, each with its own domain
      // `checksum` column value preserved verbatim (byte-for-byte restore,
      // not just "a row landed") — the "mesmos checksums" AC.
      expect(snapshots.map((s) => s.revision)).toEqual([1, 2, 3]);
      expect(snapshots.map((s) => s.checksum)).toEqual([
        'checksum-baseline-scene.json',
        'checksum-wave2-scene.json',
        'checksum-wave3-scene.json',
      ]);

      // Cross-check against the SOURCE's own current state — exact row-level
      // reconstruction, not just "the right count".
      const sourceOperations = await sourceDb
        .select()
        .from(schema.diagramOperations)
        .where(eq(schema.diagramOperations.diagramId, diagramId));
      expect(operations.map((o) => o.id).sort()).toEqual(sourceOperations.map((o) => o.id).sort());

      // The MinIO objects referenced by every wave's diagram_snapshots row
      // (not the whole bucket — only what was newly referenced) landed too.
      expect(objectStore.objects.get('exports/wave2-scene.json')).toBeDefined();
      expect(objectStore.objects.get('exports/wave3-scene.json')).toBeDefined();
    } finally {
      await targetPool.end();
    }
  }, 120_000);

  it('restoring an incremental WITHOUT its base present refuses explicitly, applying nothing (never a silent partial restore)', async () => {
    expect(backupPaths.inc1).not.toBe('');
    const objectStore = createFakeObjectStore();

    await expect(
      restoreIncrementalChain({
        chain: [backupPaths.inc1], // chain[0] must be a FULL backup — this is an incremental
        databaseUrl: negativeTargetUrl,
        objectStore,
      }),
    ).rejects.toThrow(IncrementalChainError);

    // Nothing was applied — the target database never even got a schema
    // (dump.sql never ran), proving this is a genuine refusal, not a
    // partial-then-caught-error.
    const negativePool = new Pool({ connectionString: negativeTargetUrl });
    try {
      const result = await negativePool.query(
        `SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'`,
      );
      expect(result.rows[0]?.count).toBe(0);
    } finally {
      await negativePool.end();
    }
  }, 60_000);

  it('an incremental whose declared base checksum does not match its actual predecessor is refused (broken/out-of-order chain)', async () => {
    expect(backupPaths.full).not.toBe('');
    expect(backupPaths.inc2).not.toBe('');
    const objectStore = createFakeObjectStore();

    // inc2 was chained to inc1, not to the full backup directly — skipping
    // inc1 in the chain must be caught by the checksum link, not silently
    // accepted just because chain[0] is a valid full backup.
    await expect(
      restoreIncrementalChain({
        chain: [backupPaths.full, backupPaths.inc2],
        databaseUrl: negativeTargetUrl,
        objectStore,
      }),
    ).rejects.toThrow(IncrementalChainError);
  }, 60_000);

  it('createIncrementalBackup refuses to chain onto a base that fails its own checksum verification', async () => {
    const objectStore = createFakeObjectStore();
    const tamperedBasePath = `/tmp/backup-tampered-base-${randomUUID()}.zip`;
    await createBackup({
      databaseUrl: sourceUrl,
      objectStore,
      outputPath: tamperedBasePath,
      buckets: [],
    });

    const { readFileSync, writeFileSync } = await import('node:fs');
    const JSZip = (await import('jszip')).default;
    const original = readFileSync(tamperedBasePath);
    const zip = await JSZip.loadAsync(original);
    zip.file('dump.sql', 'TAMPERED');
    writeFileSync(tamperedBasePath, await zip.generateAsync({ type: 'nodebuffer' }));

    await expect(
      createIncrementalBackup({
        databaseUrl: sourceUrl,
        objectStore,
        baseBackupPath: tamperedBasePath,
        outputPath: `/tmp/backup-inc-on-tampered-${randomUUID()}.zip`,
      }),
    ).rejects.toThrow(BackupVerificationError);
  });
});
