import type { Db } from '../auth/db.js';
import { createSnapshot, getSnapshotById } from '../snapshot/snapshots.js';
import { EXPORT_BUCKET, type StorageClient } from '../storage/index.js';
import type { FrameRow } from './frames.js';
import { listFramesForPresentation } from './frames.js';
import {
  getPresentationById,
  type PresentationRow,
  setPublishedSnapshot,
} from './presentations.js';

export interface PublishPresentationInput {
  presentationId: string;
  diagramId: string;
  actorId: string;
}

/**
 * PRS-02: publishes a presentation by creating an IMMUTABLE `diagram_snapshots`
 * row (`kind: 'published'`) via the exact same `createSnapshot` snapshot/F1c
 * already exercises for `POST /diagrams/:id/snapshots` — `'published'` has
 * been a valid `SnapshotKind` since the original schema, `createSnapshot`
 * already accepted `kind` as a parameter, and `IMMUTABLE_KINDS` already
 * includes `'published'` (confirmed by reading `snapshots.ts` before writing
 * this — the task text's premise that the signature might need adjusting did
 * not hold here; no change to that file was needed). Links the new
 * snapshot's id as `presentations.publishedSnapshotId`.
 */
export async function publishPresentation(
  db: Db,
  storage: StorageClient,
  input: PublishPresentationInput,
): Promise<PresentationRow> {
  const snapshot = await createSnapshot(db, storage, {
    diagramId: input.diagramId,
    kind: 'published',
    createdBy: input.actorId,
  });

  const presentation = await setPublishedSnapshot(db, input.presentationId, snapshot.id);
  if (!presentation) throw new Error('publishPresentation: presentation vanished mid-publish');
  return presentation;
}

export interface PublishedPresentationView {
  presentation: PresentationRow;
  frames: FrameRow[];
  scene: unknown[];
}

export class PresentationNotPublishedError extends Error {
  statusCode = 404;
  constructor(presentationId: string) {
    super(`presentation ${presentationId} has no published snapshot`);
  }
}

export class PresentationExpiredError extends Error {
  statusCode = 404;
  constructor(presentationId: string) {
    super(`presentation ${presentationId}'s published link has expired`);
  }
}

/** `settingsJson.expiresAt` (ISO string) in the past → treated as "not found", same signal as an unpublished presentation — a viewer never learns WHY a link stopped working, just that it doesn't. */
function isExpired(settingsJson: unknown): boolean {
  if (typeof settingsJson !== 'object' || settingsJson === null) return false;
  const expiresAt = (settingsJson as Record<string, unknown>).expiresAt;
  if (typeof expiresAt !== 'string') return false;
  const parsed = Date.parse(expiresAt);
  if (Number.isNaN(parsed)) return false;
  return parsed < Date.now();
}

/**
 * PRS-02: serves the read-only published view — frames (notes always
 * stripped, this is never an editor-permission context) + the FROZEN scene
 * from the published snapshot's own storage object, never the live scene
 * (confirmed by construction: this function never calls `materializeScene`
 * or touches `diagram_operations` at all).
 */
export async function getPublishedPresentation(
  db: Db,
  storage: StorageClient,
  presentationId: string,
): Promise<PublishedPresentationView> {
  const presentation = await getPresentationById(db, presentationId);
  if (!presentation) throw new PresentationNotPublishedError(presentationId);
  if (isExpired(presentation.settingsJson)) throw new PresentationExpiredError(presentationId);
  if (!presentation.publishedSnapshotId) throw new PresentationNotPublishedError(presentationId);

  const snapshot = await getSnapshotById(
    db,
    presentation.diagramId,
    presentation.publishedSnapshotId,
  );
  if (!snapshot) throw new PresentationNotPublishedError(presentationId);

  const sceneJson = await storage.getObject(EXPORT_BUCKET, snapshot.sceneJsonKey);
  const scene = JSON.parse(sceneJson.toString('utf8')) as unknown[];

  const frames = (await listFramesForPresentation(db, presentationId)).map((frame) => ({
    ...frame,
    notes: null,
  }));

  return { presentation, frames, scene };
}
