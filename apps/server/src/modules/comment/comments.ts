import { comments } from '@arch-canvas/database';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

export type CommentStatus = 'open' | 'resolved';

export interface CommentRow {
  id: string;
  diagramId: string;
  elementId: string | null;
  frameId: string | null;
  parentId: string | null;
  body: string;
  status: CommentStatus;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCommentInput {
  diagramId: string;
  authorId: string;
  body: string;
  elementId?: string | null;
  frameId?: string | null;
  parentId?: string | null;
}

/** Inserts a new comment (or a reply, when `parentId` is set) — `status` always starts `'open'`. */
export async function createComment(db: Db, input: CreateCommentInput): Promise<CommentRow> {
  const [row] = await db
    .insert(comments)
    .values({
      diagramId: input.diagramId,
      elementId: input.elementId ?? null,
      frameId: input.frameId ?? null,
      parentId: input.parentId ?? null,
      body: input.body,
      authorId: input.authorId,
    })
    .returning();
  if (!row) throw new Error('failed to insert comments row');
  return row;
}

/**
 * Flat list of every comment on `diagramId`, oldest first, each row
 * carrying its own `parentId` — thread reconstruction (CMT-01: "retorna
 * árvore ou lista flat com parentId, documentado") is left to the caller by
 * walking `parentId`, matching how `presentationFrames`/other ordered lists
 * in this codebase are already returned flat with an explicit ordering/link
 * field rather than pre-nested.
 */
export async function listComments(db: Db, diagramId: string): Promise<CommentRow[]> {
  return db
    .select()
    .from(comments)
    .where(eq(comments.diagramId, diagramId))
    .orderBy(asc(comments.createdAt));
}

export async function getCommentById(db: Db, commentId: string): Promise<CommentRow | null> {
  const [row] = await db.select().from(comments).where(eq(comments.id, commentId));
  return row ?? null;
}

export interface UpdateCommentInput {
  status?: CommentStatus;
  body?: string;
}

/** Updates `status` and/or `body` in place — comments are mutable (unlike `spec_documents`/snapshots, there is no versioning requirement for CMT-01/02). */
export async function updateComment(
  db: Db,
  commentId: string,
  input: UpdateCommentInput,
): Promise<CommentRow> {
  const [row] = await db
    .update(comments)
    .set({
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      updatedAt: new Date(),
    })
    .where(eq(comments.id, commentId))
    .returning();
  if (!row) throw new Error(`failed to update comments row "${commentId}"`);
  return row;
}
