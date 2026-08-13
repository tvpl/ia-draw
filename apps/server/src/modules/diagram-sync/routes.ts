import { can } from '@arch-canvas/auth';
import { parseOperationEnvelope } from '@arch-canvas/diagram-domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assertDeltaAssetsReady } from '../asset/index.js';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import '../auth/types.js';
import type { MetricsRegistry } from '../../core/metrics.js';
import type { JobQueue } from '../jobs/index.js';
import { type CompactionThresholds, enqueueCompaction, shouldCompact } from '../snapshot/index.js';
import { enqueueWebhookEvent } from '../webhook/deliver.js';
import { resolveDiagramWorkspaceId, resolveWorkspaceRole } from '../workspace/index.js';
import { loadOperationsAfter } from './catchup.js';
import { appendOperation } from './operations.js';
import { loadDiagramScene } from './scene.js';

export interface DiagramSyncModuleDeps {
  db: Db;
  /** Enables the VER-01 compaction trigger below when supplied — omitted call sites keep working unchanged, just without automatic compaction (e.g. tests that don't exercise it). */
  jobs?: JobQueue;
  compactionThresholds?: CompactionThresholds;
  /** OBS-01 (T91) — observes `operations:batch`'s ACK latency into the SAME histogram ws-gateway's `mutation` handler observes into (labeled `transport: 'rest'` here), per F4's "WS is just a second transport" invariant. Optional — omitted means this transport's ACK latency simply isn't observed (e.g. a test that doesn't wire a registry). */
  metrics?: MetricsRegistry;
}

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function forbidden(): never {
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

const diagramIdParamsSchema = z.object({ id: z.string().min(1) });
const catchupQuerySchema = z.object({ afterSequence: z.coerce.number().int().nonnegative() });

/** Registers the diagram-sync module's routes — the server-first persistence core (T21). */
export function registerDiagramSyncModule(app: FastifyInstance, deps: DiagramSyncModuleDeps): void {
  const { db, jobs, compactionThresholds, metrics } = deps;

  app.get('/diagrams/:id/bootstrap', { preHandler: requireSession(db) }, async (request) => {
    const { id } = diagramIdParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();

    // IDOR pattern (AUTH-04, mirrored from the workspace module): a diagram
    // outside the actor's workspace, or one that doesn't exist, is 404 —
    // never 403, which would reveal that the resource exists.
    const workspaceId = await resolveDiagramWorkspaceId(db, id);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();

    const decision = can({ role }, 'diagram:read', { workspaceId });
    if (!decision.allowed) notFound();

    const { scene, revision } = await loadDiagramScene(db, id);

    return {
      scene,
      revision,
      // No asset references exist yet — the asset module (EDT-06) is F1c.
      assets: [],
      permissions: decision,
    };
  });

  app.post(
    '/diagrams/:id/operations:batch',
    { preHandler: requireSession(db) },
    async (request, reply) => {
      const { id: diagramId } = diagramIdParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
      if (!workspaceId) notFound();

      const role = await resolveWorkspaceRole(db, workspaceId, user.id);
      if (!role) notFound();

      // reviewer/viewer never hold diagram:mutate (packages/auth) — 403, distinct
      // from diagram:read which they do hold (AUTH-03 canvas-mutation rejection).
      const decision = can({ role }, 'diagram:mutate', { workspaceId });
      if (!decision.allowed) forbidden();

      // Validates shape + the 500-element/256KB limits (T19); throws
      // OperationEnvelopeError (carries .statusCode) on violation, which core's
      // generic error handler renders as problem+json — same as notFound()/forbidden().
      const envelope = parseOperationEnvelope(request.body);

      // EDT-06: an image element is never ACKed with a broken asset reference —
      // throws AssetNotReadyError (409, problem+json) before anything is persisted
      // when a delta's image element references a pending/nonexistent asset.
      await assertDeltaAssetsReady(db, workspaceId, envelope.deltas);

      // actorId is always the authenticated session's user, never trusted from the
      // request body, mirroring the workspace module's "never accept scope/identity
      // fields from the caller" convention (see project-diagram-routes.ts).
      // OBS-01 (T91): ACK latency for this REST transport — the counterpart
      // observation in ws-gateway's `mutation` handler uses the exact same
      // histogram with `transport: 'ws'`.
      const ackStartedAt = process.hrtime.bigint();
      const result = await appendOperation(db, diagramId, user.id, envelope);
      metrics?.observeMutationAck('rest', Number(process.hrtime.bigint() - ackStartedAt) / 1e9);

      // VER-01: checked at the end of every successful batch (cheap — a handful of
      // rows in the common case) — the actual compaction work is deferred to the job
      // queue (T28) so a threshold crossing never blocks this response. Omitted
      // entirely when no job queue is wired in (see DiagramSyncModuleDeps.jobs).
      if (jobs && (await shouldCompact(db, diagramId, compactionThresholds))) {
        await enqueueCompaction(jobs, diagramId);
      }

      // EXT-02 (T80): ONE `diagram.updated` webhook event per successful
      // `operations:batch` call — never per individual delta inside it.
      // `operations:batch` is already the batching unit the client itself
      // chose (potentially many deltas per call); firing per-delta here
      // would multiply webhook volume by scene-edit granularity instead of
      // by "the client saved". Documented choice (T80's task text
      // explicitly asks for this decision to be recorded).
      await enqueueWebhookEvent(db, jobs, workspaceId, 'diagram.updated', {
        diagramId,
        workspaceId,
        revision: result.currentRevision,
        actorId: user.id,
        acks: result.acks,
      });

      reply.code(200);
      return result;
    },
  );

  app.get('/diagrams/:id/operations', { preHandler: requireSession(db) }, async (request) => {
    const { id: diagramId } = diagramIdParamsSchema.parse(request.params);
    const { afterSequence } = catchupQuerySchema.parse(request.query);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const workspaceId = await resolveDiagramWorkspaceId(db, diagramId);
    if (!workspaceId) notFound();

    const role = await resolveWorkspaceRole(db, workspaceId, user.id);
    if (!role) notFound();

    const decision = can({ role }, 'diagram:read', { workspaceId });
    if (!decision.allowed) notFound();

    const operations = await loadOperationsAfter(db, diagramId, afterSequence);
    return { operations };
  });
}
