#!/usr/bin/env node
import { createBackup } from '../create.js';
import { createIncrementalBackup } from '../incremental.js';
import { databaseUrlFromEnv, objectStoreFromEnv } from './env.js';

// usage:
//   backup:create [outputPath]
//   backup:create --incremental --base <baseBackupPath> [outputPath]   (T89, DR-01)
const args = process.argv.slice(2);
const incrementalIndex = args.indexOf('--incremental');
const isIncremental = incrementalIndex !== -1;

if (isIncremental) {
  args.splice(incrementalIndex, 1);
  const baseIndex = args.indexOf('--base');
  if (baseIndex === -1 || !args[baseIndex + 1]) {
    console.error('usage: backup:create --incremental --base <baseBackupPath> [outputPath]');
    process.exit(1);
  }
  const baseBackupPath = args[baseIndex + 1] as string;
  args.splice(baseIndex, 2);
  const outputPath =
    args[0] ?? `backup-incremental-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

  const manifest = await createIncrementalBackup({
    databaseUrl: databaseUrlFromEnv(),
    objectStore: objectStoreFromEnv(),
    baseBackupPath,
    outputPath,
  });

  console.log(`incremental backup created: ${outputPath} (base: ${baseBackupPath})`);
  console.log(
    `  since: ${manifest.sinceTimestamp}, tables: ${manifest.tables.join(', ')}, files: ${manifest.files.length}`,
  );
} else {
  const outputPath = args[0] ?? `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

  const manifest = await createBackup({
    databaseUrl: databaseUrlFromEnv(),
    objectStore: objectStoreFromEnv(),
    outputPath,
  });

  console.log(`backup created: ${outputPath}`);
  console.log(`  files: ${manifest.files.length}, buckets: ${manifest.buckets.join(', ')}`);
}
