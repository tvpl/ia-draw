import { S3Client } from '@aws-sdk/client-s3';
import type { AppConfig } from '../../core/config.js';

/** Buckets created idempotently by `infra/compose`'s `minio-init` one-shot service (T6/F0). */
export const ASSET_BUCKET = 'assets';
export const EXPORT_BUCKET = 'exports';
export const BACKUP_BUCKET = 'backups';

/**
 * Builds an S3-compatible client from `AppConfig.s3` (T3's `loadConfig`).
 * `forcePathStyle` is required for MinIO — it does not support the
 * virtual-hosted-style bucket addressing (`bucket.endpoint`) the AWS SDK
 * defaults to.
 */
export function createS3Client(config: AppConfig): S3Client {
  return new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    credentials: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey,
    },
    forcePathStyle: true,
  });
}
