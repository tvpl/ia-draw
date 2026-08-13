import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertIsolatedRestoreTarget,
  getLatestBackupPathFromDirReal,
  parseCopyRowCounts,
} from './restoreTest.js';

describe('assertIsolatedRestoreTarget (DR-02, T90) — hard fail-fast against production', () => {
  it('throws when the target equals the production database URL exactly', () => {
    const url = 'postgres://user:pass@localhost:5432/arch_canvas';
    expect(() => assertIsolatedRestoreTarget(url, url)).toThrow(
      /refusing to run a restore test against a live\/production database/,
    );
  });

  it('throws even when the two strings differ only by surrounding whitespace', () => {
    const url = 'postgres://user:pass@localhost:5432/arch_canvas';
    expect(() => assertIsolatedRestoreTarget(url, `  ${url}  `)).toThrow();
  });

  it('never throws when the target is a genuinely different connection string', () => {
    expect(() =>
      assertIsolatedRestoreTarget(
        'postgres://user:pass@localhost:5432/arch_canvas',
        'postgres://user:pass@localhost:5433/arch_canvas_restore_test',
      ),
    ).not.toThrow();
  });
});

describe('parseCopyRowCounts (DR-02, T90) — independent row-count baseline from pg_dump COPY blocks', () => {
  it('counts data lines inside a single COPY block, keyed by schema-qualified table name', () => {
    const dump = [
      'CREATE TABLE t (id serial primary key, name text);',
      'COPY public.t (id, name) FROM stdin;',
      '1\thello',
      '2\tworld',
      '\\.',
      '',
    ].join('\n');

    expect(parseCopyRowCounts(dump)).toEqual({ 'public.t': 2 });
  });

  it('counts multiple tables independently, including an empty table (0 rows)', () => {
    const dump = [
      'COPY public.a (id) FROM stdin;',
      '1',
      '2',
      '3',
      '\\.',
      'COPY public.b (id) FROM stdin;',
      '\\.',
      '',
    ].join('\n');

    expect(parseCopyRowCounts(dump)).toEqual({ 'public.a': 3, 'public.b': 0 });
  });

  it("keeps a non-public schema (e.g. drizzle-kit's own migrations bookkeeping table) distinct from a same-named public table", () => {
    const dump = [
      'COPY drizzle."__drizzle_migrations" (id, hash) FROM stdin;',
      'x\ty',
      '\\.',
      'COPY public.__drizzle_migrations (id) FROM stdin;',
      '1',
      '\\.',
      '',
    ].join('\n');

    expect(parseCopyRowCounts(dump)).toEqual({
      'drizzle.__drizzle_migrations': 1,
      'public.__drizzle_migrations': 1,
    });
  });

  it('defaults to the public schema when pg_dump emits an unqualified table name', () => {
    const dump = ['COPY "audit_events" (id, action) FROM stdin;', 'x\ty', '\\.', ''].join('\n');

    expect(parseCopyRowCounts(dump)).toEqual({ 'public.audit_events': 1 });
  });

  it('returns an empty object for a dump with no COPY blocks (e.g. INSERT-only or DDL-only)', () => {
    expect(parseCopyRowCounts('CREATE TABLE t (id serial primary key);\n')).toEqual({});
  });
});

describe('getLatestBackupPathFromDirReal (DR-02, T96) — real filesystem, never a fake backup catalog', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'arch-canvas-restore-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('picks the most recently modified *.zip entry, ignoring non-zip files', async () => {
    const older = join(dir, 'backup-2026-08-01.zip');
    const newer = join(dir, 'backup-2026-08-12.zip');
    const ignored = join(dir, 'README.txt');
    await writeFile(older, 'older');
    await writeFile(newer, 'newer');
    await writeFile(ignored, 'not a backup');

    // Real mtimes, set explicitly (rather than relying on creation-order timing, which
    // can be sub-millisecond-unstable on some filesystems) so the "most recent" claim is
    // unambiguous.
    const now = Date.now();
    await utimes(older, new Date(now - 60_000), new Date(now - 60_000));
    await utimes(newer, new Date(now), new Date(now));

    const result = await getLatestBackupPathFromDirReal(dir);
    expect(result).toBe(newer);
  });

  it('throws a clear error when the directory has no *.zip archives', async () => {
    await writeFile(join(dir, 'not-a-backup.txt'), 'irrelevant');

    await expect(getLatestBackupPathFromDirReal(dir)).rejects.toThrow(
      /no \*\.zip backup archives found/,
    );
  });

  it('throws a clear error when the directory does not exist', async () => {
    await expect(getLatestBackupPathFromDirReal(join(dir, 'does-not-exist'))).rejects.toThrow(
      /could not list backup directory/,
    );
  });
});
