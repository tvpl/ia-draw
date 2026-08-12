import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import type { BackupManifest } from './manifest.js';
import { sha256Hex } from './manifest.js';

export interface VerifyResult {
  valid: boolean;
  manifest: BackupManifest;
  /** One entry per file whose actual bytes don't match the manifest's recorded checksum, or that's listed in the manifest but missing from the archive. Empty when `valid` is true. */
  mismatches: string[];
}

/**
 * `backup:verify` (OPS-02): recomputes the SHA-256 of every file the manifest lists
 * against the archive's actual bytes, without touching any database or object store —
 * a pure, read-only integrity check. Never returns `valid: true` for a tampered
 * archive; this is what `create.spec.ts`'s "detects a deliberately tampered checksum"
 * test proves is real, not a no-op.
 */
export async function verifyBackup(backupPath: string): Promise<VerifyResult> {
  const archiveBytes = readFileSync(backupPath);
  const zip = await JSZip.loadAsync(archiveBytes);

  const manifestRaw = await zip.file('manifest.json')?.async('string');
  if (!manifestRaw)
    throw new Error(`${backupPath} has no manifest.json — not a valid backup archive`);
  const manifest = JSON.parse(manifestRaw) as BackupManifest;

  const mismatches: string[] = [];
  for (const entry of manifest.files) {
    const bytes = await zip.file(entry.path)?.async('nodebuffer');
    if (!bytes) {
      mismatches.push(`${entry.path}: listed in manifest but missing from archive`);
      continue;
    }
    const actualSha256 = sha256Hex(bytes);
    if (actualSha256 !== entry.sha256) {
      mismatches.push(
        `${entry.path}: checksum mismatch (manifest ${entry.sha256}, actual ${actualSha256})`,
      );
    }
  }

  return { valid: mismatches.length === 0, manifest, mismatches };
}
