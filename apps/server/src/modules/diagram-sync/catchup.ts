import { diagramOperations } from '@arch-canvas/database';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

/**
 * Operations with `sequence > afterSequence` for `diagramId`, ordered —
 * the catch-up query a reconnecting client uses to reconcile a stale
 * revision (T23, REC-04).
 */
export async function loadOperationsAfter(db: Db, diagramId: string, afterSequence: number) {
  return db
    .select()
    .from(diagramOperations)
    .where(
      and(
        eq(diagramOperations.diagramId, diagramId),
        gt(diagramOperations.sequence, afterSequence),
      ),
    )
    .orderBy(asc(diagramOperations.sequence));
}
