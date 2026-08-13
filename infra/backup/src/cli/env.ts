import { type BackupObjectStore, createS3Client, createS3ObjectStore } from '../objectStore.js';

/** Reads the same env var names `apps/server`'s `loadConfig` uses (DATABASE_URL, S3_*), so a single `.env` works for both. */
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required environment variable: ${name}`);
  }
  return value;
}

export function databaseUrlFromEnv(): string {
  return requiredEnv('DATABASE_URL');
}

/** Same defaults as `apps/server`'s `loadConfig` (`S3_*`), so `pnpm backup:*` works against a fresh local dev stack without extra configuration. */
export function objectStoreFromEnv(): BackupObjectStore {
  const client = createS3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    accessKeyId: process.env.S3_ACCESS_KEY ?? 'arch-canvas-dev',
    secretAccessKey: process.env.S3_SECRET_KEY ?? 'dev-insecure-secret-change-me',
  });
  return createS3ObjectStore(client);
}
