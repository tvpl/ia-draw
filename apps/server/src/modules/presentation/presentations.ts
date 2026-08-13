import { presentations } from '@arch-canvas/database';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

export interface PresentationRow {
  id: string;
  diagramId: string;
  name: string;
  publishedSnapshotId: string | null;
  settingsJson: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePresentationInput {
  diagramId: string;
  name: string;
}

/** PRS-01: creates a named, empty (zero-frame) presentation for a diagram. */
export async function createPresentation(
  db: Db,
  input: CreatePresentationInput,
): Promise<PresentationRow> {
  const [row] = await db
    .insert(presentations)
    .values({ diagramId: input.diagramId, name: input.name })
    .returning();
  if (!row) throw new Error('failed to insert presentation row');
  return row;
}

export async function listPresentationsForDiagram(
  db: Db,
  diagramId: string,
): Promise<PresentationRow[]> {
  return db
    .select()
    .from(presentations)
    .where(eq(presentations.diagramId, diagramId))
    .orderBy(desc(presentations.createdAt));
}

export async function getPresentationById(db: Db, id: string): Promise<PresentationRow | null> {
  const [row] = await db.select().from(presentations).where(eq(presentations.id, id));
  return row ?? null;
}

/** Resolves the `diagramId` a presentation belongs to — the join every route needs before it can resolve a workspace/role for RBAC (IDOR-safe: an unknown presentation id resolves to `null`, same 404 as an unknown diagram). */
export async function getPresentationDiagramId(
  db: Db,
  presentationId: string,
): Promise<string | null> {
  const row = await getPresentationById(db, presentationId);
  return row?.diagramId ?? null;
}

export interface UpdatePresentationInput {
  name?: string;
  settingsJson?: Record<string, unknown>;
}

export async function updatePresentation(
  db: Db,
  id: string,
  input: UpdatePresentationInput,
): Promise<PresentationRow | null> {
  const [row] = await db
    .update(presentations)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(presentations.id, id))
    .returning();
  return row ?? null;
}

/** Links a freshly created `diagram_snapshots` row as the presentation's published snapshot (T66) — never called from this file's own routes (T65), exported for `publish.ts` to reuse this table's write path unchanged. */
export async function setPublishedSnapshot(
  db: Db,
  id: string,
  snapshotId: string,
): Promise<PresentationRow | null> {
  const [row] = await db
    .update(presentations)
    .set({ publishedSnapshotId: snapshotId, updatedAt: new Date() })
    .where(eq(presentations.id, id))
    .returning();
  return row ?? null;
}
