import { diagramElementsMeta } from '@arch-canvas/database';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

export interface ElementMetadataRow {
  diagramId: string;
  elementId: string;
  semanticType: string | null;
  metadataJson: unknown;
  revision: number;
}

export interface UpsertElementMetadataInput {
  semanticType?: string | null;
  metadataJson?: Record<string, unknown>;
}

/** Reads the semantic metadata for one element, or `null` when none has been set yet. */
export async function getElementMetadata(
  db: Db,
  diagramId: string,
  elementId: string,
): Promise<ElementMetadataRow | null> {
  const [row] = await db
    .select()
    .from(diagramElementsMeta)
    .where(
      and(
        eq(diagramElementsMeta.diagramId, diagramId),
        eq(diagramElementsMeta.elementId, elementId),
      ),
    );
  return row ?? null;
}

/**
 * Reads every semantic metadata row for a diagram (F3/T62 docgen, T64 lint —
 * both need the full per-element metadata set, not one element at a time).
 * Read-only, no ordering guarantee beyond whatever Postgres returns.
 */
export async function listElementMetadata(
  db: Db,
  diagramId: string,
): Promise<ElementMetadataRow[]> {
  return db.select().from(diagramElementsMeta).where(eq(diagramElementsMeta.diagramId, diagramId));
}

/**
 * Upserts semantic metadata for one element (LIB-02/LIB-03) — never touches
 * `diagram_operations`/scene data, entirely in this table, keyed only by
 * `elementId`. Idempotent by construction: the composite PK means a second
 * write for the same element updates the same row (T38's invariant), never
 * creates a duplicate. `revision` is always stamped with the diagram's
 * current revision (`diagrams.current_revision`) at write time, linking the
 * metadata to the scene state it describes.
 */
export async function upsertElementMetadata(
  db: Db,
  diagramId: string,
  elementId: string,
  input: UpsertElementMetadataInput,
  revision: number,
): Promise<ElementMetadataRow> {
  const [row] = await db
    .insert(diagramElementsMeta)
    .values({
      diagramId,
      elementId,
      semanticType: input.semanticType ?? null,
      metadataJson: input.metadataJson ?? {},
      revision,
    })
    .onConflictDoUpdate({
      target: [diagramElementsMeta.diagramId, diagramElementsMeta.elementId],
      set: {
        ...(input.semanticType !== undefined ? { semanticType: input.semanticType } : {}),
        ...(input.metadataJson !== undefined ? { metadataJson: input.metadataJson } : {}),
        revision,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error('upsertElementMetadata: insert/update returned no row');
  return row;
}
