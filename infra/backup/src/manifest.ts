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
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
