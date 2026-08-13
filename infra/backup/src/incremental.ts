/**
 * Row-level (LOGICAL) incremental backup, chained to a full-backup baseline
 * (DR-01, T89).
 *
 * ── Explicit disclosure (task requirement) ──────────────────────────────
 * This is NOT Postgres WAL archiving. It captures the rows APPENDED to 3
 * specific, strictly append-only tables — `diagram_operations`,
 * `audit_events`, `diagram_snapshots` — since the base backup's own
 * `createdAt` timestamp, via genuine Postgres `COPY (SELECT ... WHERE
 * created_at > $since) TO STDOUT` / `COPY ... FROM STDIN` (the real
 * wire-protocol COPY mechanism via the real `psql` binary — never a
 * hand-rolled INSERT-statement generator). `docs/product-spec.md` §10 says
 * "incremental/WAL **quando disponível**" (when available) — this project
 * runs as a single Node monolith (AD-003) with no dedicated WAL-archiving
 * sidecar, so a literal WAL-shipping mechanism is not what "quando
 * disponível" resolves to here. Row-level capture is a deliberate,
 * disclosed choice: fully sufficient for this project's actual write
 * pattern (these 3 tables are never UPDATEd/DELETEd within their own domain
 * invariants — diagram_operations is the append-only op-log per AD-001,
 * audit_events is append-only by SEC-04/AUTH-03's own design, diagram_
 * snapshots rows are immutable once created), while being far simpler to
 * implement, restore, and verify correctly than true physical WAL shipping.
 *
 * ── Scope boundary (also disclosed) ─────────────────────────────────────
 * Only the 3 tables named above are captured incrementally — exactly what
 * T89's own task text names, nothing more. Slower-changing STRUCTURAL
 * tables (`workspaces`/`projects`/`diagrams`/`users`/etc.) are NOT captured
 * incrementally: a diagram created after the full-backup baseline has no
 * home to restore its incrementally-captured operations/snapshots into
 * until the NEXT full backup captures that diagram's own row. This mirrors
 * how incremental backups conventionally work — a delta layered on an
 * existing structural snapshot, not an independent point-in-time image —
 * and is why every restore chain below REQUIRES a full backup as its base.
 *
 * ── Chaining ─────────────────────────────────────────────────────────────
 * Every incremental manifest records `baseManifestChecksum` — the SHA-256
 * of its immediate predecessor's own `manifest.json` bytes (full OR another
 * incremental) — and `sinceTimestamp` (that predecessor's `createdAt`, the
 * row cutoff used for this capture). `restoreIncrementalChain` walks an
 * explicit, ordered chain array and verifies each link's checksum against
 * the previous entry's actual manifest before applying anything — an
 * incremental restored without (or out of order relative to) its declared
 * base throws `IncrementalChainError` and applies nothing, never a silent
 * partial restore.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { type BackupManifest, type BackupManifestEntry, sha256Hex } from './manifest.js';
import type { BackupObjectStore } from './objectStore.js';
import { BackupVerificationError, parseObjectPath, restoreBackup } from './restore.js';
import { verifyBackup } from './verify.js';

export const INCREMENTAL_TABLES = [
  'diagram_operations',
  'audit_events',
  'diagram_snapshots',
] as const;
export type IncrementalTable = (typeof INCREMENTAL_TABLES)[number];

/**
 * Explicit column lists (not implicit `SELECT *`/table-default order) so
 * the COPY dump and the COPY restore are provably using the SAME column
 * order on both sides, and so `extractSceneJsonKeys` below can locate
 * `scene_json_key` by a documented index rather than an assumption about
 * physical column order. Mirrors `packages/database/src/schema.ts`'s own
 * declared column order for each table.
 */
const TABLE_COLUMNS: Record<IncrementalTable, readonly string[]> = {
  diagram_operations: [
    'id',
    'diagram_id',
    'sequence',
    'client_mutation_id',
    'actor_id',
    'base_revision',
    'elements_delta_json',
    'operation_summary_json',
    'created_at',
  ],
  audit_events: [
    'id',
    'actor_id',
    'action',
    'resource_type',
    'resource_id',
    'ip_hash',
    'metadata_json',
    'created_at',
  ],
  diagram_snapshots: [
    'id',
    'diagram_id',
    'revision',
    'kind',
    'name',
    'scene_json_key',
    'checksum',
    'created_by',
    'immutable',
    'created_at',
  ],
};

const SCENE_JSON_KEY_INDEX = TABLE_COLUMNS.diagram_snapshots.indexOf('scene_json_key');

export interface IncrementalBackupManifest extends BackupManifest {
  type: 'incremental';
  /** SHA-256 of the immediate predecessor backup's own `manifest.json` bytes (full OR another incremental) — the explicit chain link. */
  baseManifestChecksum: string;
  /** The predecessor's `createdAt` — the row cutoff (`created_at > sinceTimestamp`) used for this capture. */
  sinceTimestamp: string;
  /** Tables captured incrementally — always `INCREMENTAL_TABLES`, recorded for self-description and drift detection. */
  tables: readonly string[];
}

/** Thrown when a restore chain is missing its base, out of order, or a link's checksum doesn't match its declared predecessor. Never a silent partial restore. */
export class IncrementalChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncrementalChainError';
  }
}

function assertIsoTimestamp(value: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`incremental.ts: invalid ISO timestamp "${value}"`);
  }
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Real, `psql`-COPY-backed capture of one table's rows created since `sinceIso` (production default — see `CreateIncrementalBackupInput.dumpTableSince`'s doc for why this is injectable). */
export function dumpTableSinceReal(
  databaseUrl: string,
  table: IncrementalTable,
  sinceIso: string,
): string {
  assertIsoTimestamp(sinceIso);
  const columns = TABLE_COLUMNS[table].join(', ');
  const sql = `COPY (SELECT ${columns} FROM ${table} WHERE created_at > ${quoteLiteral(sinceIso)}::timestamptz ORDER BY created_at) TO STDOUT`;
  return execFileSync(
    'psql',
    ['--dbname', databaseUrl, '--quiet', '--no-psqlrc', '--command', sql],
    {
      encoding: 'utf8',
      maxBuffer: 200 * 1024 * 1024,
    },
  );
}

/** Real, `psql`-COPY-backed restore of one table's captured rows (production default — see `RestoreIncrementalChainInput.restoreTableCopy`'s doc for why this is injectable). A no-op for an empty capture (nothing changed in that table for this increment). */
export function restoreTableCopyReal(
  databaseUrl: string,
  table: IncrementalTable,
  copyText: string,
): void {
  if (copyText.trim().length === 0) return;
  const columns = TABLE_COLUMNS[table].join(', ');
  execFileSync(
    'psql',
    [
      '--dbname',
      databaseUrl,
      '--quiet',
      '--no-psqlrc',
      '--set',
      'ON_ERROR_STOP=1',
      '--command',
      `COPY ${table} (${columns}) FROM STDIN`,
    ],
    { input: copyText, encoding: 'utf8', maxBuffer: 200 * 1024 * 1024 },
  );
}

/** Extracts the distinct `scene_json_key` values referenced by a captured `diagram_snapshots` COPY-text payload (tab-delimited rows, one per line, `TABLE_COLUMNS.diagram_snapshots` order). */
function extractSceneJsonKeys(copyText: string): string[] {
  const keys = new Set<string>();
  for (const line of copyText.split('\n')) {
    if (line.length === 0) continue;
    const columns = line.split('\t');
    const key = columns[SCENE_JSON_KEY_INDEX];
    if (key) keys.add(key);
  }
  return [...keys];
}

/** Canonical checksum of a manifest's own persisted form — the exact chain-link value every incremental records/verifies against. */
function manifestChecksum(manifest: BackupManifest): string {
  return sha256Hex(Buffer.from(JSON.stringify(manifest), 'utf8'));
}

export interface CreateIncrementalBackupInput {
  databaseUrl: string;
  objectStore: BackupObjectStore;
  /** Path to the backup (full OR another incremental) this new incremental chains onto. */
  baseBackupPath: string;
  outputPath: string;
  /** Bucket incrementally-referenced objects live in (`diagram_snapshots.scene_json_key`) — defaults to `'exports'`, matching `snapshot/snapshots.ts`'s `EXPORT_BUCKET`. */
  objectBucket?: string;
  /** Defaults to `dumpTableSinceReal`. Overridable — see `create.ts`'s `CreateBackupInput.dump` doc comment for why (testability without a real `pg_dump`/`psql`-compatible target in every environment). */
  dumpTableSince?: (databaseUrl: string, table: IncrementalTable, sinceIso: string) => string;
}

/**
 * `backup:create --incremental` (DR-01): captures rows appended to
 * `INCREMENTAL_TABLES` since `baseBackupPath`'s own `createdAt`, plus any
 * newly-referenced `diagram_snapshots.scene_json_key` MinIO objects, into a
 * new archive whose manifest explicitly chains to `baseBackupPath` via
 * `baseManifestChecksum`. Refuses (throws `BackupVerificationError`) if the
 * base itself fails checksum verification — an incremental is never built
 * on top of a base already known to be corrupt.
 */
export async function createIncrementalBackup(
  input: CreateIncrementalBackupInput,
): Promise<IncrementalBackupManifest> {
  const baseVerification = await verifyBackup(input.baseBackupPath);
  if (!baseVerification.valid) {
    throw new BackupVerificationError(baseVerification.mismatches);
  }
  const baseManifest = baseVerification.manifest;
  const sinceTimestamp = baseManifest.createdAt;

  const zip = new JSZip();
  const files: BackupManifestEntry[] = [];
  function addFile(path: string, bytes: Buffer): void {
    zip.file(path, bytes);
    files.push({ path, sha256: sha256Hex(bytes), sizeBytes: bytes.byteLength });
  }

  const dumpTableSince = input.dumpTableSince ?? dumpTableSinceReal;
  const capturedObjectKeys = new Set<string>();

  for (const table of INCREMENTAL_TABLES) {
    const copyText = dumpTableSince(input.databaseUrl, table, sinceTimestamp);
    addFile(`incremental/${table}.copy`, Buffer.from(copyText, 'utf8'));
    if (table === 'diagram_snapshots') {
      for (const key of extractSceneJsonKeys(copyText)) capturedObjectKeys.add(key);
    }
  }

  const objectBucket = input.objectBucket ?? 'exports';
  for (const key of capturedObjectKeys) {
    const bytes = await input.objectStore.getObject(objectBucket, key);
    addFile(`objects/${objectBucket}/${key}`, bytes);
  }

  const manifest: IncrementalBackupManifest = {
    createdAt: new Date().toISOString(),
    buckets: capturedObjectKeys.size > 0 ? [objectBucket] : [],
    files,
    type: 'incremental',
    baseManifestChecksum: manifestChecksum(baseManifest),
    sinceTimestamp,
    tables: INCREMENTAL_TABLES,
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  writeFileSync(input.outputPath, buffer);

  return manifest;
}

export interface RestoreIncrementalChainInput {
  /** Ordered chain: `chain[0]` MUST be a full backup; every subsequent entry is an incremental, applied in order. */
  chain: string[];
  databaseUrl: string;
  objectStore: BackupObjectStore;
  /** Forwarded to `restoreBackup` for `chain[0]`'s full restore — see its own doc comment. */
  restore?: (databaseUrl: string, sql: string) => void | Promise<void>;
  /** Defaults to `restoreTableCopyReal`. Overridable for the same testability reason as `dumpTableSince` above. */
  restoreTableCopy?: (
    databaseUrl: string,
    table: IncrementalTable,
    copyText: string,
  ) => void | Promise<void>;
}

/**
 * `backup:restore --chain <full.zip> <inc1.zip> <inc2.zip> ...` (DR-01):
 * restores `chain[0]` (a full backup, via the existing `restoreBackup`
 * pipeline — verified checksums, dump.sql, objects) then applies each
 * subsequent incremental IN ORDER, verifying at every step that its
 * `baseManifestChecksum` matches the actual manifest of the entry
 * immediately before it in the chain. Throws `IncrementalChainError` —
 * and applies NOTHING from the offending entry onward — the moment any
 * link doesn't hold: `chain[0]` isn't a full backup, an incremental's base
 * checksum doesn't match its predecessor, or the chain is empty. This is
 * the mechanism that makes "an incremental without its base is never
 * restorable alone" true by construction, not by convention.
 */
export async function restoreIncrementalChain(input: RestoreIncrementalChainInput): Promise<void> {
  const [baseBackupPath, ...incrementalPaths] = input.chain;
  if (!baseBackupPath) {
    throw new IncrementalChainError(
      'restoreIncrementalChain: empty chain — a full backup path is required',
    );
  }

  const baseVerification = await verifyBackup(baseBackupPath);
  if (!baseVerification.valid) {
    throw new BackupVerificationError(baseVerification.mismatches);
  }
  if (baseVerification.manifest.type === 'incremental') {
    throw new IncrementalChainError(
      `restoreIncrementalChain: chain[0] (${baseBackupPath}) is an incremental backup, not a full backup — ` +
        'an incremental can never be restored without its full-backup base as chain[0]',
    );
  }

  await restoreBackup({
    backupPath: baseBackupPath,
    databaseUrl: input.databaseUrl,
    objectStore: input.objectStore,
    restore: input.restore,
  });

  let previousManifest: BackupManifest = baseVerification.manifest;
  const restoreTableCopy = input.restoreTableCopy ?? restoreTableCopyReal;

  for (const incrementalPath of incrementalPaths) {
    const verification = await verifyBackup(incrementalPath);
    if (!verification.valid) {
      throw new BackupVerificationError(verification.mismatches);
    }
    const manifest = verification.manifest as IncrementalBackupManifest;
    if (manifest.type !== 'incremental') {
      throw new IncrementalChainError(`${incrementalPath}: not an incremental backup manifest`);
    }

    const expectedBaseChecksum = manifestChecksum(previousManifest);
    if (manifest.baseManifestChecksum !== expectedBaseChecksum) {
      throw new IncrementalChainError(
        `${incrementalPath}: baseManifestChecksum does not match its declared predecessor's actual manifest — ` +
          'refusing to restore a broken or out-of-order chain (never a silent partial restore)',
      );
    }

    const archiveBytes = readFileSync(incrementalPath);
    const zip = await JSZip.loadAsync(archiveBytes);

    for (const table of manifest.tables as IncrementalTable[]) {
      const copyText = await zip.file(`incremental/${table}.copy`)?.async('string');
      if (copyText === undefined) {
        throw new Error(
          `${incrementalPath}: missing incremental/${table}.copy (should have been caught by verify)`,
        );
      }
      await restoreTableCopy(input.databaseUrl, table, copyText);
    }

    for (const entry of manifest.files) {
      const objectPath = parseObjectPath(entry.path);
      if (!objectPath) continue;
      const bytes = await zip.file(entry.path)?.async('nodebuffer');
      if (!bytes) {
        throw new Error(
          `${entry.path}: missing from archive during restore (should have been caught by verify)`,
        );
      }
      await input.objectStore.putObject(objectPath.bucket, objectPath.key, bytes);
    }

    previousManifest = manifest;
  }
}
