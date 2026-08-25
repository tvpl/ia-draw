import type { StorageClient } from '@arch-canvas/server/dist/modules/storage/index.js';

/**
 * SRF-04: `runTestServer.ts` boots the real `apps/server`, and `registerAllModules` builds a
 * real S3 client from `config.s3` whenever no `storage` override is passed — pointed at
 * `http://localhost:9000` by default, unreachable in this harness (no MinIO here, same
 * PGlite-over-Docker trade-off AD-007 already makes for Postgres). Any route that touches
 * storage — snapshots, exports, assets, presentation publish — fails with `ECONNREFUSED`
 * before this existed. `publish.int.spec.ts`'s `createFakeStorage` is the established shape
 * for this exact seam; reused here verbatim rather than reinvented, so the e2e harness and
 * the integration suite fake storage the same way.
 */
export function createFakeStorage(): StorageClient {
  const objects = new Map<string, string>();
  return {
    async putSignedUrl(bucket, key) {
      return `https://fake-storage.test/${bucket}/${key}`;
    },
    async getSignedUrl(bucket, key) {
      return `https://fake-storage.test/${bucket}/${key}`;
    },
    async headObject(bucket, key) {
      const value = objects.get(`${bucket}/${key}`);
      return value !== undefined ? { exists: true, sizeBytes: value.length } : { exists: false };
    },
    async putObject(bucket, key, body) {
      objects.set(`${bucket}/${key}`, Buffer.isBuffer(body) ? body.toString('utf8') : String(body));
    },
    async getObject(bucket, key) {
      const value = objects.get(`${bucket}/${key}`);
      if (value === undefined) throw new Error(`object ${bucket}/${key} not found`);
      return Buffer.from(value, 'utf8');
    },
  };
}
