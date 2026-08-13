/**
 * apps/server — recurring automated restore-test job (DR-02, T90).
 *
 * Runs `backup:restore` (F1c/T89, `@arch-canvas/backup`) against an
 * ISOLATED Postgres target — never the app's own production database — on a
 * pg-boss recurring schedule (`PgBoss#schedule`, researched directly against
 * the installed `pg-boss@12.27.0` API before use, Knowledge Verification
 * Chain: v12 ships a real cron-backed recurring-job primitive, backed by its
 * own internal `__pgboss__send-it` queue + a periodic `onCron`/`shouldSendIt`
 * check — not a bespoke poller; `ConstructorOptions.schedule` defaults to
 * `true`, already the case for every `startJobs` caller in this codebase).
 *
 * ── Safety invariant ─────────────────────────────────────────────────────
 * `assertIsolatedRestoreTarget` is a hard fail-fast: if the configured
 * restore-test target is ever the same connection string as the app's own
 * `DATABASE_URL`, this throws BEFORE touching anything. There is no
 * override.
 *
 * ── Divergence detection (never a silent pass) ──────────────────────────
 * Two independent checks, run in this order:
 *   1. Checksum verification (`verifyBackup`, reused unmodified from F1c) —
 *      the SAME tamper-detection mechanism `create.int.spec.ts`/
 *      `incremental.int.spec.ts` already prove catches a backup whose bytes
 *      were altered after creation without updating its manifest checksum.
 *      A failure here means the restore is never even attempted.
 *   2. Row-count cross-check — `pg_dump`'s own dump.sql (already checksum-
 *      verified by step 1) is parsed for its `COPY <table> (...) FROM
 *      stdin; ... \.` data blocks (`parseCopyRowCounts`) to compute an
 *      INDEPENDENT expected row count per table straight from the backup's
 *      own content, then compared against `SELECT count(*)` on the restored
 *      target. This is deliberately a SEPARATE signal from the checksum
 *      check: checksum verification proves the archive's bytes are exactly
 *      what the manifest says they are; the row-count check proves the
 *      RESTORE ITSELF actually landed that exact content faithfully (e.g.
 *      would catch a `psql`/COPY-apply bug or a target that silently
 *      dropped rows — a class of failure checksum verification structurally
 *      cannot see, since it never touches the restore target at all).
 *
 * Either check failing records a `backup.restore_test.failed` audit event
 * (`severity: 'high'` in `metadataJson`) with the concrete divergence
 * detail — never a silent `backup.restore_test.succeeded`. This event shape
 * (`action`/`metadataJson.severity`) is exactly what T93's `alerts.yml`
 * (alerting-as-config) is written to key off of.
 *
 * ── Scope note on "latest backup" ───────────────────────────────────────
 * This codebase has no backup CATALOG/registry (`backup:create` just writes
 * a local `.zip` file at an operator-chosen path — see `infra/backup/src/
 * cli/create.cli.ts`). "the most recent backup" is therefore necessarily an
 * injected resolver (`getLatestBackupPath`), not something this module can
 * discover on its own — documented as a Deviation in this task's Status
 * note. A real deployment supplies one (e.g. listing a `backups/` directory
 * or object-store prefix by timestamp); tests inject a fixed path.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type BackupObjectStore,
  BackupVerificationError,
  restoreBackup,
  verifyBackup,
} from '@arch-canvas/backup';
import { recordAuditEvent } from '@arch-canvas/database';
import JSZip from 'jszip';
import { Pool } from 'pg';
import type { MetricsRegistry } from '../../core/metrics.js';
import type { Db } from '../auth/db.js';
import { defineJob, type JobQueue } from '../jobs/index.js';

export const RESTORE_TEST_JOB = 'backup-restore-test';

/** Daily at 03:00 — an off-peak default; overridable via `RestoreTestJobOptions.cron`. */
export const DEFAULT_RESTORE_TEST_CRON = '0 3 * * *';

export interface RowCountMismatch {
  table: string;
  expected: number;
  actual: number;
}

export interface RestoreTestOutcome {
  outcome: 'success' | 'failure';
  backupPath: string;
  reason?: string;
  checksumMismatches: string[];
  rowCountMismatches: RowCountMismatch[];
}

/**
 * Hard fail-fast — never allows the restore-test job to run against the
 * app's own production database. Compared as trimmed exact strings (the
 * job's target is expected to be a wholly distinct connection string, not
 * merely a different schema/search_path on the same server).
 */
export function assertIsolatedRestoreTarget(
  productionDatabaseUrl: string,
  targetDatabaseUrl: string,
): void {
  if (productionDatabaseUrl.trim() === targetDatabaseUrl.trim()) {
    throw new Error(
      'restoreTest: targetDatabaseUrl is identical to the production DATABASE_URL — refusing ' +
        'to run a restore test against a live/production database.',
    );
  }
}

/**
 * Parses `pg_dump`'s own `COPY <schema>.<table> (<cols>) FROM stdin;` ...
 * `\.` data blocks to count the rows the dump text ACTUALLY carries, per
 * SCHEMA-QUALIFIED table — the independent source of truth `runRestoreTest`
 * cross-checks post-restore row counts against (see module doc comment
 * above for why this exists alongside, not instead of, checksum
 * verification). Keys are `"<schema>.<table>"` (schema defaults to
 * `public` when `pg_dump` emits an unqualified name, though in practice
 * real `pg_dump` output always schema-qualifies) — this dump also carries
 * non-`public` tables (e.g. drizzle-kit's own `drizzle.__drizzle_migrations`
 * bookkeeping table), so an unqualified count would collide/404 across
 * schemas if the schema were dropped from the key.
 */
export function parseCopyRowCounts(dumpSql: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const lines = dumpSql.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i]?.match(/^COPY\s+(?:([A-Za-z0-9_]+)\.)?"?([A-Za-z0-9_]+)"?\s*\(/);
    if (!match) continue;
    const schemaName = match[1] ?? 'public';
    const table = match[2] as string;
    const key = `${schemaName}.${table}`;
    let rowCount = 0;
    i++;
    while (i < lines.length && lines[i] !== '\\.') {
      rowCount++;
      i++;
    }
    counts[key] = (counts[key] ?? 0) + rowCount;
  }
  return counts;
}

const QUALIFIED_TABLE_KEY_RE = /^([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/;

/** Real `pg`-backed row counter against the restore target (production default — injectable, same testability rationale as `infra/backup`'s own `dump`/`restore` overrides). Each `"<schema>.<table>"` key is validated against `QUALIFIED_TABLE_KEY_RE` before interpolation — never build SQL from an unvalidated identifier, even one sourced from our own `pg_dump` output. */
export async function countTableRowsReal(
  targetDatabaseUrl: string,
  qualifiedTables: string[],
): Promise<Record<string, number>> {
  const pool = new Pool({ connectionString: targetDatabaseUrl });
  try {
    const counts: Record<string, number> = {};
    for (const key of qualifiedTables) {
      const match = key.match(QUALIFIED_TABLE_KEY_RE);
      if (!match) continue;
      const [, schemaName, table] = match;
      const result = await pool.query(
        `SELECT count(*)::int AS count FROM "${schemaName}"."${table}"`,
      );
      counts[key] = Number((result.rows[0] as { count: number } | undefined)?.count ?? 0);
    }
    return counts;
  } finally {
    await pool.end();
  }
}

export interface RunRestoreTestInput {
  /** Writes the resulting audit event — the app's OWN operational database, never the isolated restore target. */
  db: Db;
  backupPath: string;
  objectStore: BackupObjectStore;
  /** Isolated scratch database this test restores INTO — must never equal `productionDatabaseUrl`. */
  targetDatabaseUrl: string;
  /** The app's real `DATABASE_URL` — used only for the isolation guard, never connected to by this function. */
  productionDatabaseUrl: string;
  /** Defaults to `restoreBackup`. Overridable for the same testability reason as `infra/backup`'s own injection points. */
  restore?: (databaseUrl: string, sql: string) => void | Promise<void>;
  /** Defaults to `countTableRowsReal`. Overridable — see its own doc comment. */
  countTableRows?: (targetDatabaseUrl: string, tables: string[]) => Promise<Record<string, number>>;
  /**
   * Optional (T93, OBS-03) — when supplied, a divergence also increments
   * `arch_canvas_restore_test_failures_total` (`MetricsRegistry`, T91/T93)
   * so `infra/observability/alerts.yml`'s "invalid backup/restore" rule has
   * a real `/metrics` series to fire on, alongside the audit event this
   * function already wrote (F5/T90). Omitted entirely = the audit trail
   * (the only signal T90 originally shipped) still works unchanged — same
   * optional-degrade shape as every other `deps.metrics`/`deps.jobs` seam.
   */
  metrics?: MetricsRegistry;
}

async function recordOutcome(
  input: Pick<RunRestoreTestInput, 'db' | 'metrics'>,
  action: 'backup.restore_test.succeeded' | 'backup.restore_test.failed',
  metadata: Record<string, unknown>,
): Promise<void> {
  await recordAuditEvent(input.db, {
    action,
    resourceType: 'backup',
    resourceId: randomUUID(),
    metadataJson: metadata,
  });
  if (action === 'backup.restore_test.failed') {
    input.metrics?.recordRestoreTestFailure();
  }
}

/**
 * Runs one restore-test cycle: verify → restore into an isolated target →
 * cross-check row counts → record exactly one audit event describing the
 * outcome. Never throws on a detected divergence (tamper or row-count
 * mismatch) — those are reported as a `{ outcome: 'failure' }` result AND a
 * high-severity audit event, so a scheduled pg-boss run of this never
 * crash-loops the job on an expected "the backup was bad" outcome. It DOES
 * throw (before writing anything) if `targetDatabaseUrl` equals
 * `productionDatabaseUrl` — that is a configuration error, not a backup
 * divergence, and must never be swallowed into a routine failure event.
 */
export async function runRestoreTest(input: RunRestoreTestInput): Promise<RestoreTestOutcome> {
  assertIsolatedRestoreTarget(input.productionDatabaseUrl, input.targetDatabaseUrl);
  const countTableRows = input.countTableRows ?? countTableRowsReal;

  let verification: Awaited<ReturnType<typeof verifyBackup>>;
  try {
    verification = await verifyBackup(input.backupPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await recordOutcome(input, 'backup.restore_test.failed', {
      backupPath: input.backupPath,
      reason,
      severity: 'high',
    });
    return {
      outcome: 'failure',
      backupPath: input.backupPath,
      reason,
      checksumMismatches: [],
      rowCountMismatches: [],
    };
  }

  if (!verification.valid) {
    await recordOutcome(input, 'backup.restore_test.failed', {
      backupPath: input.backupPath,
      reason: 'checksum verification failed — backup archive does not match its own manifest',
      checksumMismatches: verification.mismatches,
      severity: 'high',
    });
    return {
      outcome: 'failure',
      backupPath: input.backupPath,
      reason: 'checksum verification failed',
      checksumMismatches: verification.mismatches,
      rowCountMismatches: [],
    };
  }

  // dump.sql is already checksum-verified above — safe to trust its bytes
  // as the expected-row-count baseline.
  const archiveBytes = readFileSync(input.backupPath);
  const zip = await JSZip.loadAsync(archiveBytes);
  const dumpSql = await zip.file('dump.sql')?.async('string');
  const expectedCounts = dumpSql ? parseCopyRowCounts(dumpSql) : {};

  try {
    await restoreBackup({
      backupPath: input.backupPath,
      databaseUrl: input.targetDatabaseUrl,
      objectStore: input.objectStore,
      restore: input.restore,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const checksumMismatches =
      error instanceof BackupVerificationError ? [...error.mismatches] : [];
    await recordOutcome(input, 'backup.restore_test.failed', {
      backupPath: input.backupPath,
      reason,
      checksumMismatches,
      severity: 'high',
    });
    return {
      outcome: 'failure',
      backupPath: input.backupPath,
      reason,
      checksumMismatches,
      rowCountMismatches: [],
    };
  }

  const actualCounts = await countTableRows(input.targetDatabaseUrl, Object.keys(expectedCounts));
  const rowCountMismatches: RowCountMismatch[] = [];
  for (const [table, expected] of Object.entries(expectedCounts)) {
    const actual = actualCounts[table] ?? 0;
    if (actual !== expected) rowCountMismatches.push({ table, expected, actual });
  }

  if (rowCountMismatches.length > 0) {
    await recordOutcome(input, 'backup.restore_test.failed', {
      backupPath: input.backupPath,
      reason: 'row counts diverge from the backup dump content after restore',
      rowCountMismatches,
      severity: 'high',
    });
    return {
      outcome: 'failure',
      backupPath: input.backupPath,
      reason: 'row count divergence',
      checksumMismatches: [],
      rowCountMismatches,
    };
  }

  await recordOutcome(input, 'backup.restore_test.succeeded', {
    backupPath: input.backupPath,
    tablesChecked: Object.keys(expectedCounts).length,
    severity: 'info',
  });

  return {
    outcome: 'success',
    backupPath: input.backupPath,
    checksumMismatches: [],
    rowCountMismatches: [],
  };
}

/**
 * T96 — a real, filesystem-based `getLatestBackupPath` resolver: lists `dir` (a real
 * `readdir`, never a bespoke catalog), keeps only `*.zip` entries (the backup archive
 * format `create.ts`/`incremental.ts` both write), `stat`s each for its real mtime, and
 * returns the most recently modified one. This is ONE reasonable interpretation of the
 * module doc comment's own "Scope note on 'latest backup'" (this codebase genuinely has
 * no backup catalog/registry) — an operator whose backup automation drops timestamped
 * archives into one directory gets a correct, real answer with zero extra bookkeeping.
 * Throws a clear, operator-facing error when the directory is empty or missing, rather
 * than silently resolving to nothing and having `runRestoreTest` fail confusingly later.
 */
export async function getLatestBackupPathFromDirReal(dir: string): Promise<string> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`restoreTest: could not list backup directory "${dir}": ${reason}`);
  }

  const zipEntries = entries.filter((entry) => entry.endsWith('.zip'));
  if (zipEntries.length === 0) {
    throw new Error(`restoreTest: no *.zip backup archives found in "${dir}"`);
  }

  const withMtimes = await Promise.all(
    zipEntries.map(async (entry) => {
      const fullPath = join(dir, entry);
      const stats = await stat(fullPath);
      return { fullPath, mtimeMs: stats.mtimeMs };
    }),
  );

  withMtimes.sort((a, b) => b.mtimeMs - a.mtimeMs);
  // biome-ignore lint/style/noNonNullAssertion: withMtimes is non-empty by construction (zipEntries.length > 0 above)
  return withMtimes[0]!.fullPath;
}

export interface RestoreTestJobOptions {
  targetDatabaseUrl: string;
  productionDatabaseUrl: string;
  objectStore: BackupObjectStore;
  /** Resolves the backup archive to test on each run — see the module doc comment's "Scope note on 'latest backup'". */
  getLatestBackupPath: () => Promise<string> | string;
  /** Defaults to `DEFAULT_RESTORE_TEST_CRON` (daily, 03:00). */
  cron?: string;
  restore?: RunRestoreTestInput['restore'];
  countTableRows?: RunRestoreTestInput['countTableRows'];
  /** T93 (OBS-03) — forwarded to `runRestoreTest`'s `RunRestoreTestInput.metrics`. */
  metrics?: MetricsRegistry;
}

/**
 * Registers the recurring `backup-restore-test` pg-boss job (T28's wiring
 * pattern, same shape as `registerCompactionJob`/`registerWebhookDeliveryJob`
 * — `jobs`/`db` required params here; the OPTIONAL `deps.jobs` degrade this
 * mirrors lives at the call site, e.g. `if (deps.jobs) await
 * registerRestoreTestJob(deps.jobs, db, ...)`, exactly like every other job
 * in `registerModules.ts` — never inside this function). Also schedules it
 * via `jobs.schedule` (pg-boss's real recurring-job primitive) so it runs on
 * `options.cron` without any external scheduler.
 */
export async function registerRestoreTestJob(
  jobs: JobQueue,
  db: Db,
  options: RestoreTestJobOptions,
): Promise<void> {
  await defineJob(jobs, RESTORE_TEST_JOB, async () => {
    const backupPath = await options.getLatestBackupPath();
    await runRestoreTest({
      db,
      backupPath,
      objectStore: options.objectStore,
      targetDatabaseUrl: options.targetDatabaseUrl,
      productionDatabaseUrl: options.productionDatabaseUrl,
      restore: options.restore,
      countTableRows: options.countTableRows,
      metrics: options.metrics,
    });
  });

  await jobs.schedule(RESTORE_TEST_JOB, options.cron ?? DEFAULT_RESTORE_TEST_CRON, {});
}
