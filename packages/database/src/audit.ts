import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import { auditEvents } from './schema.js';
import type * as schema from './schema.js';

type Schema = typeof schema;
type Db<TQueryResult extends PgQueryResultHKT> =
  | PgDatabase<TQueryResult, Schema>
  | PgTransaction<TQueryResult, Schema, ExtractTablesWithRelations<Schema>>;

export interface AuditEventInput {
  actorId?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  ipHash?: string;
  metadataJson?: Record<string, unknown>;
}

/**
 * Appends one row to `audit_events`. This is the only writer of that table
 * (AUTH-03) — it never UPDATEs or DELETEs, mirroring the append-only
 * invariant of the table itself.
 */
export async function recordAuditEvent<TQueryResult extends PgQueryResultHKT>(
  db: Db<TQueryResult>,
  event: AuditEventInput,
): Promise<void> {
  await db.insert(auditEvents).values({
    actorId: event.actorId,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    ipHash: event.ipHash,
    metadataJson: event.metadataJson ?? {},
  });
}
