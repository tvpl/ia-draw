import { can } from '@arch-canvas/auth';
import { workspaces } from '@arch-canvas/database';
import { extractSceneSemantics } from '@arch-canvas/diagram-domain';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import '../auth/types.js';
import { listElementMetadata } from '../library/metadata.js';
import { materializeScene } from '../snapshot/scene.js';
import { resolveDiagramWorkspaceId, resolveWorkspaceRole } from '../workspace/index.js';
import { lintDiagram, type WorkspaceLintRules } from './engine.js';

export interface LintModuleDeps {
  db: Db;
}

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function forbidden(): never {
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

const diagramIdParamsSchema = z.object({ id: z.string().min(1) });

/** Reads `workspaces.settingsJson.lintRules` (LNT-03) — no new column/table, reuses the existing jsonb settings blob (F1a). Missing/malformed shape degrades to "no overrides", never throws. */
async function loadWorkspaceLintRules(
  db: Db,
  workspaceId: string,
): Promise<WorkspaceLintRules | undefined> {
  const [row] = await db
    .select({ settingsJson: workspaces.settingsJson })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  const settings = row?.settingsJson;
  if (typeof settings !== 'object' || settings === null) return undefined;
  const lintRules = (settings as Record<string, unknown>).lintRules;
  if (typeof lintRules !== 'object' || lintRules === null) return undefined;
  return lintRules as WorkspaceLintRules;
}

/** Registers the lint module's route (LNT-01/02/03): `GET /diagrams/:id/lint` — always 200, never blocks on warnings. */
export function registerLintModule(app: FastifyInstance, deps: LintModuleDeps): void {
  const { db } = deps;

  app.get('/diagrams/:id/lint', { preHandler: requireSession(db) }, async (request) => {
    const { id: diagramId } = diagramIdParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();

    const decision = can({ role }, 'diagram:read', { workspaceId });
    if (!decision.allowed) notFound();

    const [{ scene }, elementsMeta, workspaceRules] = await Promise.all([
      materializeScene(db, diagramId),
      listElementMetadata(db, diagramId),
      loadWorkspaceLintRules(db, workspaceId),
    ]);

    const metadataInputs = elementsMeta.map((row) => ({
      elementId: row.elementId,
      semantics: {
        ...(row.semanticType !== null ? { semanticType: row.semanticType } : {}),
        ...(typeof row.metadataJson === 'object' && row.metadataJson !== null
          ? row.metadataJson
          : {}),
      },
    }));
    const semantics = extractSceneSemantics(scene, metadataInputs);

    const warnings = lintDiagram(scene, semantics, elementsMeta, workspaceRules);
    return { warnings };
  });
}
