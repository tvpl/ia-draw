import { can } from '@arch-canvas/auth';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createRateLimitPreHandler, InMemoryRateLimiter } from '../../core/rateLimit.js';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import '../auth/types.js';
import type { StorageClient } from '../storage/index.js';
import { resolveDiagramWorkspaceId, resolveWorkspaceRole } from '../workspace/index.js';
import { type AiRunStatus, getAiRunById } from './aiRuns.js';
import { approveAiRun, cancelAiRun } from './applyPatch.js';
import { type CreateAiRunDeps, createAiRun } from './pipeline.js';
import { attachPreview } from './preview.js';
import { RunStore } from './runStore.js';

export interface AiEngineModuleDeps {
  db: Db;
  encryptionKey: string;
  storage: StorageClient;
  /** Injectable for tests — defaults to the real global `fetch` in production. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests — defaults to a fresh, empty store (one per module registration, mirrors ai-provider's `InMemoryRateLimiter` convention). */
  runStore?: RunStore;
  /** Test-only observability seam (see pipeline.ts's `CreateAiRunDeps.onTransition`). */
  onTransition?: (runId: string, status: AiRunStatus) => void;
  /**
   * Injectable, separately-configured rate limiter for `POST
   * /diagrams/:id/ai/runs` (SEC-02, T83) — deliberately stricter than
   * `core/server.ts`'s default per-authenticated-route limit, closing the
   * gap AIC-04 (F2a) disclosed as partial ("limites de workspace/budget
   * deferidos"). Defaults to a fresh in-memory limiter, same convention as
   * `ai-provider`'s `testConnectionRateLimiter`.
   */
  aiRunRateLimiter?: InMemoryRateLimiter;
}

/** Stricter than `core/server.ts`'s default (300/60s) — an AI run is materially more expensive (provider call, patch computation) than an ordinary REST request. */
const DEFAULT_AI_RUN_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function forbidden(): never {
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

const diagramIdParamsSchema = z.object({ id: z.string().min(1) });
const runRefParamsSchema = z.object({ runRef: z.string().min(1) });
const createRunBodySchema = z.object({
  userRequest: z.string().min(1),
  language: z.string().min(1).optional(),
  diagramKind: z.string().min(1).optional(),
  selection: z.array(z.string().min(1)).optional(),
});

/**
 * `POST /ai/runs/{id}:approve|:cancel` (design.md's Google-AIP-136-style
 * custom-method URLs) can't reuse this codebase's usual
 * `:id(^[^:]+):action` route-regex trick — `find-my-way` (Fastify's
 * router) collapses TWO differently-suffixed regex-constrained parametric
 * routes on the same path prefix into a single dedup key, throwing
 * "Method already declared" on the second one (confirmed directly against
 * the installed `find-my-way` version; every existing single-action route
 * in this codebase, e.g. `:test`/`:restore`, only ever registers ONE such
 * route per prefix, so this collision never surfaced before `:approve` AND
 * `:cancel` shared a prefix). A single un-constrained `:runRef` param
 * captures the whole segment (colons included, since `:` is not a path
 * separator), and this function splits it back into `runId`/`action` —
 * the external URL contract stays byte-for-byte the same, only the
 * server-side route registration differs.
 */
function parseRunRef(runRef: string): { runId: string; action: 'approve' | 'cancel' } | null {
  const separatorIndex = runRef.lastIndexOf(':');
  if (separatorIndex <= 0) return null;
  const runId = runRef.slice(0, separatorIndex);
  const action = runRef.slice(separatorIndex + 1);
  if (action !== 'approve' && action !== 'cancel') return null;
  return { runId, action };
}

/**
 * Registers the `ai-engine` module's routes (T53-T55, design.md `ai-engine`
 * interfaces): `POST /diagrams/{id}/ai/runs` creates and runs a pipeline
 * through to `previewing`/`failed`, continuing to `awaiting_approval` in
 * the same request (T54); `POST /ai/runs/{id}:approve` applies the patch
 * atomically with a `pre_ai` undo snapshot, `POST /ai/runs/{id}:cancel`
 * cancels without applying anything (T55).
 */
export function registerAiEngineModule(app: FastifyInstance, deps: AiEngineModuleDeps): void {
  const { db, encryptionKey, storage, fetchImpl, onTransition } = deps;
  const runStore = deps.runStore ?? new RunStore();
  const pipelineDeps: CreateAiRunDeps = { db, encryptionKey, fetchImpl, runStore, onTransition };
  const aiRunRateLimiter =
    deps.aiRunRateLimiter ?? new InMemoryRateLimiter(DEFAULT_AI_RUN_RATE_LIMIT);
  const aiRunRateLimited = createRateLimitPreHandler(
    aiRunRateLimiter,
    (request) => request.authContext?.user?.id ?? request.ip,
  );

  /** RBAC shared by `:approve`/`:cancel`: resolves the run's diagram -> workspace -> role, same IDOR (404-not-403) and diagram:mutate convention every other mutating route in this codebase uses. */
  async function requireRunMutateAccess(runId: string, userId: string) {
    const run = await getAiRunById(db, runId);
    if (!run) notFound();

    const workspaceId = await resolveDiagramWorkspaceId(db, run.diagramId);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, userId);
    if (!role) notFound();

    const decision = can({ role }, 'diagram:mutate', { workspaceId });
    if (!decision.allowed) forbidden();

    return run;
  }

  app.post(
    '/diagrams/:id/ai/runs',
    { preHandler: [requireSession(db), aiRunRateLimited] },
    async (request, reply) => {
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

      // T54: a run that reached `previewing` continues, in the same request, to
      // the preview + approval-threshold step (previewing -> awaiting_approval)
      // — design.md's pipeline has no separate endpoint for this. A run T53
      // already failed (no RunStore entry) is returned unchanged.
      const withPreview = await attachPreview(db, runStore, result.run);
      if (withPreview) {
        return {
          run: withPreview.run,
          patch: result.patch,
          preview: withPreview.preview,
          requiresExplicitApproval: withPreview.requiresExplicitApproval,
          toolCallCount: result.toolCallCount,
        };
      }

      return { run: result.run, patch: result.patch, toolCallCount: result.toolCallCount };
    },
  );

  app.post('/ai/runs/:runRef', { preHandler: requireSession(db) }, async (request) => {
    const { runRef } = runRefParamsSchema.parse(request.params);
    const parsed = parseRunRef(runRef);
    if (!parsed) notFound();

    const user = request.authContext?.user;
    if (!user) forbidden();

    await requireRunMutateAccess(parsed.runId, user.id);

    if (parsed.action === 'cancel') {
      const run = await cancelAiRun(db, runStore, parsed.runId);
      return { run };
    }

    // Every failure mode (unknown run, wrong state, stale sourceRevision, no
    // pending patch) throws a typed error carrying its own `statusCode` —
    // core's generic error handler renders it as problem+json, same as every
    // notFound()/forbidden() call above.
    const result = await approveAiRun({ db, storage, runStore }, parsed.runId, user.id);
    return { run: result.run, snapshot: result.snapshot, batch: result.batch };
  });
}
