import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import type { BackupManifest } from './manifest.js';
import type { BackupObjectStore } from './objectStore.js';
import { restoreDatabase } from './pgDump.js';
import { verifyBackup } from './verify.js';

export interface RestoreInput {
  backupPath: string;
  /** Target database — expected empty; `psql --set ON_ERROR_STOP=1` fails loud on any conflict (e.g. a table that already exists). */
  databaseUrl: string;
  objectStore: BackupObjectStore;
  /** Defaults to `pgDump.ts`'s real `psql`-backed `restoreDatabase` (sync). Overridable — see `CreateBackupInput.dump`'s doc comment for why; may return a `Promise` (awaited) for an async injected implementation. */
  restore?: (databaseUrl: string, sql: string) => void | Promise<void>;
}

/** Thrown when the pre-restore verification step finds any checksum mismatch — restore never proceeds against a corrupted archive. */
export class BackupVerificationError extends Error {
  readonly mismatches: readonly string[];
  constructor(mismatches: readonly string[]) {
    super(`backup verification failed before restore: ${mismatches.join('; ')}`);
    this.name = 'BackupVerificationError';
    this.mismatches = mismatches;
  }
}

/** Exported for reuse by `incremental.ts` (T89) — same `objects/<bucket>/<key>` archive path convention. */
export function parseObjectPath(path: string): { bucket: string; key: string } | null {
  const match = path.match(/^objects\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const [, bucket, key] = match;
  if (!bucket || !key) return null;
  return { bucket, key };
}

/**
 * `backup:restore` (OPS-02, OPS-03): re-verifies checksums first (OPS-02 — "fails loud
 * if any checksum doesn't match"), then applies the SQL dump to `databaseUrl` and
 * copies every object back to its bucket in `objectStore`. Throws
 * `BackupVerificationError` (non-zero exit at the CLI) before touching either target
 * if verification fails — restore is all-or-nothing on a known-good archive.
 */
export async function restoreBackup(input: RestoreInput): Promise<BackupManifest> {
  const verification = await verifyBackup(input.backupPath);
  if (!verification.valid) {
    throw new BackupVerificationError(verification.mismatches);
  }

  const archiveBytes = readFileSync(input.backupPath);
  const zip = await JSZip.loadAsync(archiveBytes);

  const dumpSql = await zip.file('dump.sql')?.async('string');
  if (dumpSql === undefined) throw new Error('backup archive has no dump.sql');
  const restore = input.restore ?? restoreDatabase;
  await restore(input.databaseUrl, dumpSql);

  for (const entry of verification.manifest.files) {
    const objectPath = parseObjectPath(entry.path);
    if (!objectPath) continue;
    const bytes = await zip.file(entry.path)?.async('nodebuffer');
    if (!bytes)
      throw new Error(
        `${entry.path}: missing from archive during restore (should have been caught by verify)`,
      );
    await input.objectStore.putObject(objectPath.bucket, objectPath.key, bytes);
  }

  return verification.manifest;
}
