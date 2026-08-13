import { writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { type BackupManifest, type BackupManifestEntry, sha256Hex } from './manifest.js';
import type { BackupObjectStore } from './objectStore.js';
import { dumpDatabase } from './pgDump.js';

export interface CreateBackupInput {
  databaseUrl: string;
  objectStore: BackupObjectStore;
  /** Buckets to capture — defaults to the `assets`/`exports` triad minus `backups` itself (OPS-01). */
  buckets?: string[];
  /** Local path to write the single-file backup archive (a `.zip`) to. */
  outputPath: string;
  /** Defaults to `pgDump.ts`'s real `pg_dump`-backed `dumpDatabase`. Overridable so the orchestration (manifest/checksums/zip packaging) is testable against a source that isn't a real `pg_dump`-compatible server — see `create.int.spec.ts` for exactly why that matters in this sandbox. */
  dump?: (databaseUrl: string) => string;
}

export const DEFAULT_BACKUP_BUCKETS = ['assets', 'exports'];

/**
 * `backup:create` (OPS-01, OPS-02): dumps the Postgres database (`pg_dump`), copies
 * every object out of the configured buckets, and packages both plus a SHA-256
 * checksum manifest into one `.zip` file at `outputPath`.
 */
export async function createBackup(input: CreateBackupInput): Promise<BackupManifest> {
  const buckets = input.buckets ?? DEFAULT_BACKUP_BUCKETS;
  const zip = new JSZip();
  const files: BackupManifestEntry[] = [];

  function addFile(path: string, bytes: Buffer): void {
    zip.file(path, bytes);
    files.push({ path, sha256: sha256Hex(bytes), sizeBytes: bytes.byteLength });
  }

  const dump = input.dump ?? dumpDatabase;
  const dumpSql = dump(input.databaseUrl);
  addFile('dump.sql', Buffer.from(dumpSql, 'utf8'));

  for (const bucket of buckets) {
    const keys = await input.objectStore.listObjects(bucket);
    for (const key of keys) {
      const bytes = await input.objectStore.getObject(bucket, key);
      addFile(`objects/${bucket}/${key}`, bytes);
    }
  }

  const manifest: BackupManifest = {
    createdAt: new Date().toISOString(),
    buckets,
    files,
    type: 'full',
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  writeFileSync(input.outputPath, buffer);

  return manifest;
}
