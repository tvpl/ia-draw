// SPEC_DEVIATION / honesty note (T34, mirrors T6/T27's pattern): this sandbox has no
// Docker and no second real Postgres/MinIO stack to restore into end-to-end via the
// literal `pg_dump`/`psql` binaries. `dump`/`restore` are injected (see `create.ts`'s
// and `restore.ts`'s doc comments) so this test exercises the REAL create/verify/
// restore orchestration — zip packaging, SHA-256 manifest, checksum verification,
// object-store round-trip — while substituting the DB boundary. The restore side is
// not a bare mock: SQL is applied to a genuinely separate, fresh `@electric-sql/pglite`
// instance (a real embedded Postgres-compatible engine, not the source's) via its own
// `.exec()`, then queried back — proving the dump content really lands, not just that
// a function got called. `pg_dump`/`psql` themselves ARE real binaries present in this
// sandbox (`/usr/bin/pg_dump`, `/usr/bin/psql`) and `@electric-sql/pglite-socket` can
// expose a PGlite instance over a real TCP Postgres wire-protocol socket — verified
// manually: `psql` connects and queries it successfully. `pg_dump` specifically cannot
// — it refuses with "aborting because of server version mismatch" (PGlite reports
// server_version 18.3; this sandbox's `pg_dump` is 16.13, and pg_dump has no override
// flag for dumping a newer server, a real PostgreSQL safety rule). That reproduction
// was not stable enough under the Vitest runner's process/socket handling to commit as
// an automated assertion (flaky timeouts, not present when run as a standalone script)
// — documented here rather than shipped as an unreliable test. Object storage uses an
// in-memory fake (no real MinIO in this sandbox, T27's established limitation).
import { randomUUID } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { createBackup } from './create.js';
import { sha256Hex } from './manifest.js';
import type { BackupObjectStore } from './objectStore.js';
import { BackupVerificationError, restoreBackup } from './restore.js';
import { verifyBackup } from './verify.js';

const SAMPLE_DUMP_SQL = `
CREATE TABLE t (id serial primary key, name text);
INSERT INTO t (name) VALUES ('hello'), ('world');
`;

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

describe('createBackup -> verifyBackup -> restoreBackup (T34, OPS-01/02/03)', () => {
  const filesToClean: string[] = [];

  afterEach(() => {
    for (const path of filesToClean.splice(0)) {
      try {
        unlinkSync(path);
      } catch {
        // already removed
      }
    }
  });

  it('backup:create produces a manifest with checksums matching the real archived bytes', async () => {
    const objectStore = createFakeObjectStore();
    const assetBytes = Buffer.from('fake-asset-bytes-for-backup-test');
    await objectStore.putObject('assets', 'a1.png', assetBytes);

    const outputPath = join(tmpdir(), `backup-create-${randomUUID()}.zip`);
    filesToClean.push(outputPath);

    const manifest = await createBackup({
      databaseUrl: 'unused-in-this-test',
      objectStore,
      outputPath,
      dump: () => SAMPLE_DUMP_SQL,
    });

    expect(manifest.files.map((f) => f.path).sort()).toEqual(
      ['dump.sql', 'objects/assets/a1.png'].sort(),
    );
    const dumpEntry = manifest.files.find((f) => f.path === 'dump.sql');
    expect(dumpEntry?.sha256).toBe(sha256Hex(Buffer.from(SAMPLE_DUMP_SQL, 'utf8')));
    const assetEntry = manifest.files.find((f) => f.path === 'objects/assets/a1.png');
    expect(assetEntry?.sha256).toBe(sha256Hex(assetBytes));
    expect(assetEntry?.sizeBytes).toBe(assetBytes.byteLength);
  });

  it('backup:verify on a fresh archive reports valid: true', async () => {
    const objectStore = createFakeObjectStore();
    const outputPath = join(tmpdir(), `backup-verify-${randomUUID()}.zip`);
    filesToClean.push(outputPath);

    await createBackup({
      databaseUrl: 'unused',
      objectStore,
      outputPath,
      dump: () => SAMPLE_DUMP_SQL,
    });

    const result = await verifyBackup(outputPath);
    expect(result.valid).toBe(true);
  });

  it('backup:restore against a fresh, empty target recovers the data with matching checksums (OPS-03)', async () => {
    const sourceObjectStore = createFakeObjectStore();
    const assetBytes = Buffer.from('another-fake-asset');
    await sourceObjectStore.putObject('exports', 'e1.json', assetBytes);

    const outputPath = join(tmpdir(), `backup-restore-${randomUUID()}.zip`);
    filesToClean.push(outputPath);

    const createdManifest = await createBackup({
      databaseUrl: 'unused',
      objectStore: sourceObjectStore,
      outputPath,
      dump: () => SAMPLE_DUMP_SQL,
    });

    // A genuinely separate, fresh PGlite instance — the "empty target stack" (OPS-03's
    // "restore against an empty stack recovers data").
    const targetDb = await PGlite.create();
    const targetObjectStore = createFakeObjectStore();
    let appliedSql: string | undefined;

    const restoredManifest = await restoreBackup({
      backupPath: outputPath,
      databaseUrl: 'unused',
      objectStore: targetObjectStore,
      restore: async (_url, sql) => {
        appliedSql = sql;
        // Real SQL execution against a real embedded Postgres-compatible engine —
        // not a no-op mock — awaited so restoreBackup only resolves once it lands.
        await targetDb.exec(sql);
      },
    });

    expect(appliedSql).toBe(SAMPLE_DUMP_SQL);
    expect(restoredManifest.files.map((f) => f.path).sort()).toEqual(
      createdManifest.files.map((f) => f.path).sort(),
    );

    const rows = await targetDb.query<{ name: string }>('SELECT name FROM t ORDER BY name;');
    expect(rows.rows.map((r) => r.name)).toEqual(['hello', 'world']);
    await targetDb.close();

    const restoredBytes = targetObjectStore.objects.get('exports/e1.json');
    expect(restoredBytes).toEqual(assetBytes);
    expect(restoredBytes ? sha256Hex(restoredBytes) : null).toBe(sha256Hex(assetBytes));
  });

  it('backup:restore fails loud (throws, never applies anything) when a checksum has been tampered with (OPS-02/03)', async () => {
    const objectStore = createFakeObjectStore();
    const outputPath = join(tmpdir(), `backup-restore-tampered-${randomUUID()}.zip`);
    filesToClean.push(outputPath);

    await createBackup({
      databaseUrl: 'unused',
      objectStore,
      outputPath,
      dump: () => SAMPLE_DUMP_SQL,
    });

    // Corrupt the archive's dump.sql bytes in place (append a byte) without touching
    // manifest.json's recorded checksum — simulates bit-rot/corruption after creation.
    const original = readFileSync(outputPath);
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(original);
    zip.file('dump.sql', `${SAMPLE_DUMP_SQL}-- tampered`);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(outputPath, await zip.generateAsync({ type: 'nodebuffer' }));

    let restoreWasCalled = false;
    await expect(
      restoreBackup({
        backupPath: outputPath,
        databaseUrl: 'unused',
        objectStore: createFakeObjectStore(),
        restore: () => {
          restoreWasCalled = true;
        },
      }),
    ).rejects.toThrow(BackupVerificationError);

    expect(restoreWasCalled).toBe(false);
  });
});
