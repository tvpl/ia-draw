import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './manifest.js';
import { verifyBackup } from './verify.js';

async function writeBackupArchive(
  path: string,
  files: { path: string; bytes: Buffer; recordedSha256?: string }[],
): Promise<void> {
  const zip = new JSZip();
  const manifest = {
    createdAt: new Date().toISOString(),
    buckets: ['assets'],
    files: files.map((f) => ({
      path: f.path,
      sha256: f.recordedSha256 ?? sha256Hex(f.bytes),
      sizeBytes: f.bytes.byteLength,
    })),
  };
  for (const f of files) zip.file(f.path, f.bytes);
  zip.file('manifest.json', JSON.stringify(manifest));
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  writeFileSync(path, buffer);
}

describe('verifyBackup (T34, OPS-02)', () => {
  it('reports valid: true when every file matches its manifest checksum', async () => {
    const path = join(tmpdir(), `backup-verify-valid-${Date.now()}.zip`);
    await writeBackupArchive(path, [
      { path: 'dump.sql', bytes: Buffer.from('SELECT 1;') },
      { path: 'objects/assets/a.png', bytes: Buffer.from('fake-png-bytes') },
    ]);

    const result = await verifyBackup(path);

    expect(result.valid).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it('detects a deliberately tampered checksum (proves verification is real, not a no-op)', async () => {
    const path = join(tmpdir(), `backup-verify-tampered-${Date.now()}.zip`);
    const bytes = Buffer.from('original content');
    await writeBackupArchive(path, [
      // Manifest records a checksum for DIFFERENT bytes than what's actually in the
      // archive — simulates corruption/tampering after the manifest was written.
      { path: 'dump.sql', bytes, recordedSha256: sha256Hex(Buffer.from('tampered content')) },
    ]);

    const result = await verifyBackup(path);

    expect(result.valid).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toMatch(/dump\.sql: checksum mismatch/);
  });

  it('reports a mismatch when a manifest-listed file is missing from the archive', async () => {
    const path = join(tmpdir(), `backup-verify-missing-${Date.now()}.zip`);
    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        createdAt: new Date().toISOString(),
        buckets: [],
        files: [{ path: 'dump.sql', sha256: 'deadbeef', sizeBytes: 10 }],
      }),
    );
    writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }));

    const result = await verifyBackup(path);

    expect(result.valid).toBe(false);
    expect(result.mismatches[0]).toMatch(/dump\.sql: listed in manifest but missing/);
  });

  it('throws a clear error for a file with no manifest.json at all', async () => {
    const path = join(tmpdir(), `backup-verify-no-manifest-${Date.now()}.zip`);
    const zip = new JSZip();
    zip.file('dump.sql', 'SELECT 1;');
    writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }));

    await expect(verifyBackup(path)).rejects.toThrow(/has no manifest\.json/);
  });
});
