import { diagramOperations } from '@arch-canvas/database';
import { reconcileOperation } from '@arch-canvas/diagram-domain';
import type { ElementDelta, SceneElement, SceneIndex } from '@arch-canvas/editor-adapter';
import { and, asc, eq, lte } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

export interface MaterializedScene {
  scene: SceneElement[];
  revision: number;
}

/**
 * Materializes a diagram's scene by folding its op-log through
 * `reconcileOperation`, optionally bounded to `upToSequence` (inclusive) —
 * used to reconstruct the scene AS OF a specific revision (snapshot
 * creation, restore-as-new-revision, diff). Mirrors diagram-sync's
 * `loadDiagramScene` fold (same reconcile pattern; not imported directly to
 * keep the surgical footprint of this task limited to the snapshot module —
 * see diagram-sync/scene.ts's own TODO about eventually starting folds from
 * the latest snapshot instead of the full op-log, a performance follow-up
 * this task does not claim).
 */
export async function materializeScene(
  db: Db,
  diagramId: string,
  upToSequence?: number,
): Promise<MaterializedScene> {
  const where =
    upToSequence === undefined
      ? eq(diagramOperations.diagramId, diagramId)
      : and(
          eq(diagramOperations.diagramId, diagramId),
          lte(diagramOperations.sequence, upToSequence),
        );

  const ops = await db
    .select({
      sequence: diagramOperations.sequence,
      elementsDeltaJson: diagramOperations.elementsDeltaJson,
    })
    .from(diagramOperations)
    .where(where)
    .orderBy(asc(diagramOperations.sequence));

  let sceneIndex: SceneIndex = new Map();
  let revision = 0;

  for (const op of ops) {
    const deltas = op.elementsDeltaJson as ElementDelta[];
    const { scene } = reconcileOperation(sceneIndex, deltas);
    sceneIndex = scene;
    revision = op.sequence;
  }

  return { scene: Array.from(sceneIndex.values()), revision };
}
