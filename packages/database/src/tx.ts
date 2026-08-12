import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import type * as schema from './schema.js';

/** The full Drizzle schema shape — exported so consumers can type their own `db` handles consistently with `withTx`. */
export type Schema = typeof schema;

/**
 * Runs `fn` inside a transaction and returns its result, rolling back on throw.
 * Generic over the pg query-result kind so it works against both the
 * node-postgres driver (runtime) and the PGlite driver (tests).
 */
export async function withTx<TQueryResult extends PgQueryResultHKT, T>(
  db: PgDatabase<TQueryResult, Schema>,
  fn: (tx: PgTransaction<TQueryResult, Schema, ExtractTablesWithRelations<Schema>>) => Promise<T>,
): Promise<T> {
  return db.transaction(fn);
}
