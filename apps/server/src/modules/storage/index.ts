/**
 * apps/server — storage module (T27, EXP-01 pre-requisite).
 *
 * SPEC_DEVIATION: no real MinIO is reachable in this sandbox (no Docker
 * daemon, see .specs/STATE.md AD-007) so `signedUrl.spec.ts` mocks the S3
 * SDK client boundary (`S3Client.send`) instead of exercising a live MinIO —
 * this proves `StorageClient`'s own request-shaping/error-mapping logic, not
 * MinIO's actual behavior. CI (GitHub Actions, real Docker) runs the same
 * suite against real MinIO via `services:` and is the environment that
 * verifies live-object correctness end to end.
 */
export { ASSET_BUCKET, BACKUP_BUCKET, createS3Client, EXPORT_BUCKET } from './client.js';
export { createStorageClient, type HeadObjectResult, type StorageClient } from './signedUrl.js';
