#!/usr/bin/env node
import { restoreBackup } from '../restore.js';
import { databaseUrlFromEnv, objectStoreFromEnv } from './env.js';

const backupPath = process.argv[2];
if (!backupPath) {
  console.error('usage: backup:restore <path-to-backup.zip>');
  process.exit(1);
}

try {
  const manifest = await restoreBackup({
    backupPath,
    databaseUrl: databaseUrlFromEnv(),
    objectStore: objectStoreFromEnv(),
  });
  console.log(`restore complete: ${manifest.files.length} files applied`);
} catch (error) {
  console.error(`RESTORE FAILED: ${(error as Error).message}`);
  process.exit(1);
}
