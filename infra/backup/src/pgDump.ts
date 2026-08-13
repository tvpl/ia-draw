import { execFileSync } from 'node:child_process';

/**
 * `pg_dump`/`psql` are real PostgreSQL client binaries (verified present in this
 * environment at `/usr/bin/pg_dump`/`/usr/bin/psql` before writing this — Knowledge
 * Verification Chain), invoked synchronously since these are short-lived one-shot CLI
 * scripts, not server request handlers. `--no-owner --no-privileges` keeps the dump
 * portable across a target database whose role names may differ from the source's.
 */
export function dumpDatabase(databaseUrl: string): string {
  return execFileSync('pg_dump', ['--no-owner', '--no-privileges', '--dbname', databaseUrl], {
    encoding: 'utf8',
    maxBuffer: 200 * 1024 * 1024,
  });
}

/** Applies a SQL dump (from `dumpDatabase`) to `databaseUrl` via `psql`, failing loud (throws) on the first SQL error (`ON_ERROR_STOP=1`) instead of silently continuing past a broken statement. */
export function restoreDatabase(databaseUrl: string, sql: string): void {
  execFileSync('psql', ['--dbname', databaseUrl, '--set', 'ON_ERROR_STOP=1', '--quiet'], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 200 * 1024 * 1024,
  });
}
