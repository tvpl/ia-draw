import { diagramOperations } from '@arch-canvas/database';
import { reconcileOperation } from '@arch-canvas/diagram-domain';
import type { ElementDelta, SceneElement, SceneIndex } from '@arch-canvas/editor-adapter';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

export interface DiagramSceneState {
  scene: SceneElement[];
  revision: number;
}

/**
 * Rebuilds a diagram's current scene by folding its entire op-log, oldest
 * to newest, through `reconcileOperation` (diagram-domain's LWW composer).
 *
 * TODO(F1c): once diagram_snapshots has real compacted rows (VER-01), start
 * from the latest snapshot's `sceneJsonKey` + only the operations with
 * `sequence > snapshot.revision`, instead of folding the whole op-log every
 * call. The route contract (bootstrap returns `{ scene, revision }`) is
 * already correct for that; this is a pure performance follow-up.
 */
export async function loadDiagramScene(db: Db, diagramId: string): Promise<DiagramSceneState> {
  const ops = await db
    .select({
      sequence: diagramOperations.sequence,
      elementsDeltaJson: diagramOperations.elementsDeltaJson,
    })
    .from(diagramOperations)
    .where(eq(diagramOperations.diagramId, diagramId))
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
