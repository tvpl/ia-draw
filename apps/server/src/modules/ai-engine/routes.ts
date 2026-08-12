import { can } from '@arch-canvas/auth';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import '../auth/types.js';
import { resolveDiagramWorkspaceId, resolveWorkspaceRole } from '../workspace/index.js';
import type { AiRunStatus } from './aiRuns.js';
import { type CreateAiRunDeps, createAiRun } from './pipeline.js';
import { RunStore } from './runStore.js';

export interface AiEngineModuleDeps {
  db: Db;
  encryptionKey: string;
  /** Injectable for tests — defaults to the real global `fetch` in production. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests — defaults to a fresh, empty store (one per module registration, mirrors ai-provider's `InMemoryRateLimiter` convention). */
  runStore?: RunStore;
  /** Test-only observability seam (see pipeline.ts's `CreateAiRunDeps.onTransition`). */
  onTransition?: (runId: string, status: AiRunStatus) => void;
}

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function forbidden(): never {
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

const diagramIdParamsSchema = z.object({ id: z.string().min(1) });
const createRunBodySchema = z.object({
  userRequest: z.string().min(1),
  language: z.string().min(1).optional(),
  diagramKind: z.string().min(1).optional(),
  selection: z.array(z.string().min(1)).optional(),
});

/**
 * Registers the `ai-engine` module's routes (T53-T55, design.md `ai-engine`
 * interfaces): `POST /diagrams/{id}/ai/runs` creates and runs a pipeline
 * through to `previewing`/`failed`; `:approve`/`:cancel` land in T55.
 */
export function registerAiEngineModule(app: FastifyInstance, deps: AiEngineModuleDeps): void {
  const { db, encryptionKey, fetchImpl, onTransition } = deps;
  const runStore = deps.runStore ?? new RunStore();
  const pipelineDeps: CreateAiRunDeps = { db, encryptionKey, fetchImpl, runStore, onTransition };

  app.post('/diagrams/:id/ai/runs', { preHandler: requireSession(db) }, async (request, reply) => {
    const { id: diagramId } = diagramIdParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();

    // Creating an AI run proposes canvas mutations — the same permission
    // boundary as operations:batch (AUTH-03: reviewer/viewer never mutate).
    const decision = can({ role }, 'diagram:mutate', { workspaceId });
    if (!decision.allowed) forbidden();

    const body = createRunBodySchema.parse(request.body);

    const result = await createAiRun(pipelineDeps, {
      diagramId,
      workspaceId,
      userId: user.id,
      userRequest: body.userRequest,
      language: body.language,
      diagramKind: body.diagramKind,
      selection: body.selection,
    });

    reply.code(201);
    return { run: result.run, patch: result.patch, toolCallCount: result.toolCallCount };
  });
}
