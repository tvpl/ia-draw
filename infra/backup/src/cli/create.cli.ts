#!/usr/bin/env node
import { createBackup } from '../create.js';
import { databaseUrlFromEnv, objectStoreFromEnv } from './env.js';

const outputPath =
  process.argv[2] ?? `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

const manifest = await createBackup({
  databaseUrl: databaseUrlFromEnv(),
  objectStore: objectStoreFromEnv(),
  outputPath,
});

console.log(`backup created: ${outputPath}`);
console.log(`  files: ${manifest.files.length}, buckets: ${manifest.buckets.join(', ')}`);
