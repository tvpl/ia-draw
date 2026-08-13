import { type StructuralDiffResult, structuralDiff } from '@arch-canvas/diagram-domain';
import type { Db } from '../auth/db.js';
import { materializeScene } from './scene.js';
import { getSnapshotById } from './snapshots.js';

const REVISION_PATTERN = /^\d+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class DiffTargetNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(value: string) {
    super(`diff target "${value}" is neither a known revision nor a known snapshot id`);
    this.name = 'DiffTargetNotFoundError';
  }
}

/**
 * Resolves a `from`/`to` query value (VER-04: "entre duas revisões ou
 * snapshots") to a revision number: a plain integer string is used as-is;
 * anything else is looked up as a snapshot id, using that snapshot's own
 * `revision`.
 */
export async function resolveRevision(db: Db, diagramId: string, value: string): Promise<number> {
  if (REVISION_PATTERN.test(value)) return Number(value);

  // Never queried as a uuid literal unless it's actually shaped like one — Postgres would
  // reject a malformed uuid outright (500), and a malformed id can never resolve anyway.
  if (!UUID_PATTERN.test(value)) throw new DiffTargetNotFoundError(value);

  const snapshot = await getSnapshotById(db, diagramId, value);
  if (!snapshot) throw new DiffTargetNotFoundError(value);
  return snapshot.revision;
}

/** Diffs the scene as of `fromValue` against the scene as of `toValue` (each a revision number or a snapshot id). */
export async function diffDiagram(
  db: Db,
  diagramId: string,
  fromValue: string,
  toValue: string,
): Promise<StructuralDiffResult> {
  const fromRevision = await resolveRevision(db, diagramId, fromValue);
  const toRevision = await resolveRevision(db, diagramId, toValue);

  const [{ scene: fromScene }, { scene: toScene }] = await Promise.all([
    materializeScene(db, diagramId, fromRevision),
    materializeScene(db, diagramId, toRevision),
  ]);

  return structuralDiff(fromScene, toScene);
}
