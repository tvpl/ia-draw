import { createHash } from 'node:crypto';

export interface BackupManifestEntry {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface BackupManifest {
  createdAt: string;
  /** Object storage buckets this backup captured (design.md `minio-init`'s `assets`/`exports` triad — `backups` itself is excluded to avoid a backup containing earlier backups). */
  buckets: string[];
  files: BackupManifestEntry[];
  /**
   * DR-01 (T89): `'full'` for the ordinary `backup:create` output (this
   * repo's original F1c manifests predate this field and simply omit it —
   * treated as `'full'` wherever the distinction matters, so this is a
   * backward-compatible addition, not a breaking one); `'incremental'` for
   * `incremental.ts`'s row-level incremental output, which also carries the
   * extra `baseManifestChecksum`/`sinceTimestamp`/`tables` fields (see
   * `IncrementalBackupManifest`).
   */
  type?: 'full' | 'incremental';
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
