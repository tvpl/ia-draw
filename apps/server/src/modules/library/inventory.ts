import { diagramElementsMeta } from '@arch-canvas/database';
import { eq } from 'drizzle-orm';
import type { Db } from '../auth/db.js';
import { loadDiagramScene } from '../diagram-sync/scene.js';

export interface InventoryRow {
  elementId: string;
  /** The element's current scene type (e.g. "rectangle", "arrow"), or `null` when the element no longer exists in the scene. */
  elementType: string | null;
  semanticType: string | null;
  metadataJson: unknown;
  revision: number;
}

/**
 * Joins `diagram_elements_meta` with the diagram's current scene (LIB-04) —
 * one row per element that has semantic metadata, enriched with its live
 * scene `type` when the element still exists. Never reads or mutates
 * upstream Excalidraw fields beyond `id`/`type` (LIB-02's boundary).
 */
export async function buildInventory(db: Db, diagramId: string): Promise<InventoryRow[]> {
  const [metaRows, { scene }] = await Promise.all([
    db.select().from(diagramElementsMeta).where(eq(diagramElementsMeta.diagramId, diagramId)),
    loadDiagramScene(db, diagramId),
  ]);

  const sceneTypeById = new Map(scene.map((element) => [element.id, element.type as string]));

  return metaRows.map((row) => ({
    elementId: row.elementId,
    elementType: sceneTypeById.get(row.elementId) ?? null,
    semanticType: row.semanticType,
    metadataJson: row.metadataJson,
    revision: row.revision,
  }));
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Renders inventory rows as CSV — same content as the JSON form, different format (T39 "Done when"). */
export function toCsv(rows: readonly InventoryRow[]): string {
  const header = ['elementId', 'elementType', 'semanticType', 'revision', 'metadataJson'];
  const lines = rows.map((row) =>
    [
      row.elementId,
      row.elementType ?? '',
      row.semanticType ?? '',
      String(row.revision),
      JSON.stringify(row.metadataJson),
    ]
      .map(csvEscape)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}
