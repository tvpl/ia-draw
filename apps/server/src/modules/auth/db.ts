import type { Schema } from '@arch-canvas/database';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

/**
 * Drizzle handle generic over the underlying pg driver — the same instance
 * shape works against the real node-postgres pool at runtime and against
 * PGlite in integration tests (mirrors packages/database's `withTx`).
 */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
