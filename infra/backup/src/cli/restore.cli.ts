#!/usr/bin/env node
import { restoreIncrementalChain } from '../incremental.js';
import { restoreBackup } from '../restore.js';
import { databaseUrlFromEnv, objectStoreFromEnv } from './env.js';

// usage:
//   backup:restore <path-to-backup.zip>
//   backup:restore --chain <full.zip> <inc1.zip> [inc2.zip ...]   (T89, DR-01)
const args = process.argv.slice(2);
const chainIndex = args.indexOf('--chain');

try {
  if (chainIndex !== -1) {
    const chain = args.slice(chainIndex + 1);
    if (chain.length === 0) {
      console.error('usage: backup:restore --chain <full.zip> <inc1.zip> [inc2.zip ...]');
      process.exit(1);
    }
    await restoreIncrementalChain({
      chain,
      databaseUrl: databaseUrlFromEnv(),
      objectStore: objectStoreFromEnv(),
    });
    console.log(
      `chained restore complete: ${chain.length} archive(s) applied (${chain.join(' -> ')})`,
    );
  } else {
    const backupPath = args[0];
    if (!backupPath) {
      console.error('usage: backup:restore <path-to-backup.zip>');
      process.exit(1);
    }
    const manifest = await restoreBackup({
      backupPath,
      databaseUrl: databaseUrlFromEnv(),
      objectStore: objectStoreFromEnv(),
    });
    console.log(`restore complete: ${manifest.files.length} files applied`);
  }
} catch (error) {
  console.error(`RESTORE FAILED: ${(error as Error).message}`);
  process.exit(1);
}
