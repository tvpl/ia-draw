import { diagramOperations, withTx } from '@arch-canvas/database';
import type { OperationEnvelope } from '@arch-canvas/diagram-domain';
import type { ElementDelta } from '@arch-canvas/editor-adapter';
import { and, asc, desc, eq, gt } from 'drizzle-orm';
import type { Db } from '../auth/db.js';
import { isUniqueViolation } from '../workspace/index.js';

export interface DiagramOperationRow {
  id: string;
  diagramId: string;
  sequence: number;
  clientMutationId: string;
  actorId: string;
  baseRevision: number;
  elementsDeltaJson: unknown;
  operationSummaryJson: unknown;
  createdAt: Date;
}

export interface OperationAck {
  clientMutationId: string;
  sequence: number;
}

export interface BatchResult {
  acks: OperationAck[];
  /** No per-delta rejection exists in this wave — RBAC failures reject the whole request via HTTP 403 instead. Reserved for future validation-level rejections. */
  rejected: [];
  currentRevision: number;
  /** Operations the client's `baseRevision` missed — present whenever the batch landed behind the diagram's current revision (design.md Error Handling Strategy: "baseRevision obsoleta"). The client reconciles with these via `reconcileOperation`/`applyRemote`; the server never rejects on staleness alone. */
  missingOperations: DiagramOperationRow[];
}

function summarizeDeltas(deltas: ElementDelta[]) {
  return {
    upserts: deltas.filter((delta) => delta.kind === 'upsert').length,
    deletes: deltas.filter((delta) => delta.kind === 'delete').length,
    elementIds: deltas.map((delta) => delta.elementId),
  };
}

async function findExistingOperation(
  db: Db,
  diagramId: string,
  clientMutationId: string,
): Promise<DiagramOperationRow | null> {
  const [row] = await db
    .select()
    .from(diagramOperations)
    .where(
      and(
        eq(diagramOperations.diagramId, diagramId),
        eq(diagramOperations.clientMutationId, clientMutationId),
      ),
    );
  return row ?? null;
}

async function latestSequence(db: Db, diagramId: string): Promise<number> {
  const [row] = await db
    .select({ sequence: diagramOperations.sequence })
    .from(diagramOperations)
    .where(eq(diagramOperations.diagramId, diagramId))
    .orderBy(desc(diagramOperations.sequence))
    .limit(1);
  return row?.sequence ?? 0;
}

async function buildResult(
  db: Db,
  diagramId: string,
  op: DiagramOperationRow,
): Promise<BatchResult> {
  const revision = await latestSequence(db, diagramId);
  const missingOperations =
    op.baseRevision < revision - 1
      ? await db
          .select()
          .from(diagramOperations)
          .where(
            and(
              eq(diagramOperations.diagramId, diagramId),
              gt(diagramOperations.sequence, op.baseRevision),
            ),
          )
          .orderBy(asc(diagramOperations.sequence))
          .then((rows) => rows.filter((row) => row.clientMutationId !== op.clientMutationId))
      : [];

  return {
    acks: [{ clientMutationId: op.clientMutationId, sequence: op.sequence }],
    rejected: [],
    currentRevision: revision,
    missingOperations,
  };
}

const MAX_SEQUENCE_RETRIES = 5;

/**
 * Appends `envelope`'s deltas to `diagramId`'s op-log inside one transaction
 * and resolves only once that transaction has committed — the ACK-after-
 * commit invariant (EDT-03) is structural here: this promise cannot resolve
 * before Postgres durably persists the row, so a caller can never observe a
 * result without a matching committed row.
 *
 * Idempotent (EDT-04): a `clientMutationId` already present for this diagram
 * short-circuits to the existing row's ack, with no write attempt. A race
 * between two concurrent identical resubmissions is closed by catching the
 * (diagram_id, client_mutation_id) unique-violation (T20) and re-reading —
 * exactly one row is ever persisted for a given `clientMutationId`.
 *
 * `sequence` is computed as `MAX(sequence) + 1` inside the same transaction;
 * a concurrent writer for the *same diagram* (different `clientMutationId`)
 * can still collide on the (diagram_id, sequence) unique index — that
 * specific violation is retried (recomputing the new max) up to
 * `MAX_SEQUENCE_RETRIES` times, never silently dropped.
 *
 * Never rejects a stale `baseRevision` outright (LWW model, AD-001) — deltas
 * are appended regardless, and `missingOperations` is returned so the
 * client reconciles locally instead of the server discarding anything.
 */
export async function appendOperation(
  db: Db,
  diagramId: string,
  actorId: string,
  envelope: OperationEnvelope,
): Promise<BatchResult> {
  const existing = await findExistingOperation(db, diagramId, envelope.clientMutationId);
  if (existing) return buildResult(db, diagramId, existing);

  let inserted: DiagramOperationRow | undefined;

  for (let attempt = 0; attempt < MAX_SEQUENCE_RETRIES && !inserted; attempt++) {
    try {
      inserted = await withTx(db, async (tx) => {
        const nextSequence = (await latestSequence(tx, diagramId)) + 1;
        const [row] = await tx
          .insert(diagramOperations)
          .values({
            diagramId,
            sequence: nextSequence,
            clientMutationId: envelope.clientMutationId,
            actorId,
            baseRevision: envelope.baseRevision,
            elementsDeltaJson: envelope.deltas,
            operationSummaryJson: summarizeDeltas(envelope.deltas),
          })
          .returning();
        if (!row) throw new Error('failed to persist diagram operation');
        return row;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      // Either another writer just persisted this exact clientMutationId
      // (idempotent race — return its ack) or collided on `sequence` alone
      // (concurrent-writer race on this diagram — loop and recompute).
      const raced = await findExistingOperation(db, diagramId, envelope.clientMutationId);
      if (raced) return buildResult(db, diagramId, raced);
    }
  }

  if (!inserted) {
    throw Object.assign(new Error('Could not persist diagram operation after retries'), {
      statusCode: 409,
    });
  }

  return buildResult(db, diagramId, inserted);
}
