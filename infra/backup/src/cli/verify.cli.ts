#!/usr/bin/env node
import { verifyBackup } from '../verify.js';

const backupPath = process.argv[2];
if (!backupPath) {
  console.error('usage: backup:verify <path-to-backup.zip>');
  process.exit(1);
}

const result = await verifyBackup(backupPath);

if (result.valid) {
  console.log(`OK: ${backupPath} — ${result.manifest.files.length} files, all checksums match`);
  process.exit(0);
} else {
  console.error(`FAILED: ${backupPath} — ${result.mismatches.length} checksum mismatch(es):`);
  for (const mismatch of result.mismatches) console.error(`  - ${mismatch}`);
  process.exit(1);
}
