import { presentationFrames } from '@arch-canvas/database';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

export interface NavLink {
  targetFrameId: string;
}

export interface FrameRow {
  id: string;
  presentationId: string;
  elementId: string | null;
  frameId: string | null;
  position: number;
  notes: string | null;
  navLinksJson: unknown;
  createdAt: Date;
}

export class InvalidNavLinkError extends Error {
  statusCode = 400;
  constructor(targetFrameId: string) {
    super(
      `navLinksJson targetFrameId '${targetFrameId}' does not reference a frame in this presentation`,
    );
  }
}

/** PRS-03: every `navLinksJson` entry must point at a frame that already exists in the SAME presentation — never a dangling click-through link. Throws `InvalidNavLinkError` (400) on the first offender. */
async function assertNavLinksResolve(
  db: Db,
  presentationId: string,
  navLinks: readonly NavLink[] | undefined,
): Promise<void> {
  if (!navLinks || navLinks.length === 0) return;
  const existing = await db
    .select({ id: presentationFrames.id })
    .from(presentationFrames)
    .where(eq(presentationFrames.presentationId, presentationId));
  const existingIds = new Set(existing.map((row) => row.id));
  for (const link of navLinks) {
    if (!existingIds.has(link.targetFrameId)) throw new InvalidNavLinkError(link.targetFrameId);
  }
}

export async function listFramesForPresentation(
  db: Db,
  presentationId: string,
): Promise<FrameRow[]> {
  return db
    .select()
    .from(presentationFrames)
    .where(eq(presentationFrames.presentationId, presentationId))
    .orderBy(asc(presentationFrames.position));
}

export async function getFrameById(
  db: Db,
  presentationId: string,
  frameId: string,
): Promise<FrameRow | null> {
  const [row] = await db
    .select()
    .from(presentationFrames)
    .where(
      and(
        eq(presentationFrames.id, frameId),
        eq(presentationFrames.presentationId, presentationId),
      ),
    );
  return row ?? null;
}

export interface CreateFrameInput {
  elementId?: string | null;
  frameId?: string | null;
  position: number;
  notes?: string | null;
  navLinksJson?: NavLink[];
}

export async function createFrame(
  db: Db,
  presentationId: string,
  input: CreateFrameInput,
): Promise<FrameRow> {
  await assertNavLinksResolve(db, presentationId, input.navLinksJson);
  const [row] = await db
    .insert(presentationFrames)
    .values({
      presentationId,
      elementId: input.elementId ?? null,
      frameId: input.frameId ?? null,
      position: input.position,
      notes: input.notes ?? null,
      navLinksJson: input.navLinksJson ?? [],
    })
    .returning();
  if (!row) throw new Error('failed to insert presentation_frames row');
  return row;
}

export interface UpdateFrameInput {
  elementId?: string | null;
  frameId?: string | null;
  position?: number;
  notes?: string | null;
  navLinksJson?: NavLink[];
}

export async function updateFrame(
  db: Db,
  presentationId: string,
  frameId: string,
  input: UpdateFrameInput,
): Promise<FrameRow | null> {
  await assertNavLinksResolve(db, presentationId, input.navLinksJson);
  const [row] = await db
    .update(presentationFrames)
    .set(input)
    .where(
      and(
        eq(presentationFrames.id, frameId),
        eq(presentationFrames.presentationId, presentationId),
      ),
    )
    .returning();
  return row ?? null;
}

export class UnknownFrameIdError extends Error {
  statusCode = 400;
  constructor(id: string) {
    super(`frame id '${id}' does not belong to this presentation`);
  }
}

/** PRS-01: batch reorder — every `{id, position}` pair must already belong to `presentationId`, or the whole batch is rejected (never a partial reorder). */
export async function bulkReorderFrames(
  db: Db,
  presentationId: string,
  updates: readonly { id: string; position: number }[],
): Promise<FrameRow[]> {
  if (updates.length === 0) return listFramesForPresentation(db, presentationId);

  const ids = updates.map((u) => u.id);
  const existing = await db
    .select({ id: presentationFrames.id })
    .from(presentationFrames)
    .where(
      and(
        eq(presentationFrames.presentationId, presentationId),
        inArray(presentationFrames.id, ids),
      ),
    );
  const existingIds = new Set(existing.map((row) => row.id));
  for (const update of updates) {
    if (!existingIds.has(update.id)) throw new UnknownFrameIdError(update.id);
  }

  for (const update of updates) {
    await db
      .update(presentationFrames)
      .set({ position: update.position })
      .where(
        and(
          eq(presentationFrames.id, update.id),
          eq(presentationFrames.presentationId, presentationId),
        ),
      );
  }
  return listFramesForPresentation(db, presentationId);
}

export async function deleteFrame(
  db: Db,
  presentationId: string,
  frameId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(presentationFrames)
    .where(
      and(
        eq(presentationFrames.id, frameId),
        eq(presentationFrames.presentationId, presentationId),
      ),
    )
    .returning({ id: presentationFrames.id });
  return deleted.length > 0;
}
