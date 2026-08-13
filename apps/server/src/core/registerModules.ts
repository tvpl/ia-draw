import type { FastifyInstance } from 'fastify';
import { registerAiEngineModule } from '../modules/ai-engine/routes.js';
import { registerAiProviderModule } from '../modules/ai-provider/routes.js';
import { registerAssetModule } from '../modules/asset/routes.js';
import type { Db } from '../modules/auth/db.js';
import { registerAuthModule } from '../modules/auth/routes.js';
import { registerCommentModule } from '../modules/comment/routes.js';
import { registerDiagramSyncModule } from '../modules/diagram-sync/routes.js';
import { registerDocgenModule } from '../modules/docgen/routes.js';
import { BULK_WORKSPACE_BUNDLE_JOB, registerBulkBundleJob } from '../modules/export/bulkBundle.js';
import { registerExportModule } from '../modules/export/routes.js';
import { registerInteropModule } from '../modules/interop/routes.js';
import type { JobQueue } from '../modules/jobs/index.js';
import { registerLibraryModule } from '../modules/library/routes.js';
import { registerLintModule } from '../modules/lint/routes.js';
import { registerPresentationPublishModule } from '../modules/presentation/publishRoutes.js';
import { registerPresentationModule } from '../modules/presentation/routes.js';
import { registerShareModule } from '../modules/share/routes.js';
import { COMPACT_DIAGRAM_JOB, registerCompactionJob } from '../modules/snapshot/compaction.js';
import { registerSnapshotModule } from '../modules/snapshot/routes.js';
import { createS3Client } from '../modules/storage/client.js';
import { createStorageClient, type StorageClient } from '../modules/storage/signedUrl.js';
import { registerWebhookDeliveryJob, WEBHOOK_DELIVERY_JOB } from '../modules/webhook/deliver.js';
import { registerWebhookModule } from '../modules/webhook/routes.js';
import { registerWorkspaceModule } from '../modules/workspace/routes.js';
import {
  InMemoryPresenceBroadcaster,
  type PresenceBroadcaster,
} from '../modules/ws-gateway/presence.js';
import { RedisPresenceBroadcaster } from '../modules/ws-gateway/redisPresence.js';
import { registerWsGatewayModule } from '../modules/ws-gateway/routes.js';
import type { AppConfig } from './config.js';
import './metrics.js';
import { type Tracing, withSpan } from './tracing.js';

/**
 * OBS-02 (T92) — the storage boundary named in the task's own "limites
 * documentados (REST, WS, banco, storage, chamada de provedor de IA)".
 * Wraps every `StorageClient` method (real S3/MinIO calls AND any
 * test-injected `deps.storage` double, harmlessly — a span around a fake
 * call is still just a span) in a span named `storage.<operation>`.
 * Attributes are limited to the bucket name (a fixed config value, never
 * user input) — deliberately NEVER the object `key` (a caller-influenced
 * string, e.g. an asset filename), matching this task's "ids/counts only,
 * never content" discipline everywhere else in this wave.
 */
function wrapStorageWithTracing(client: StorageClient, tracing: Tracing): StorageClient {
  return {
    putSignedUrl: (bucket, key, contentType, ttlSeconds) =>
      withSpan(tracing.tracer, 'storage.put_signed_url', { 'storage.bucket': bucket }, () =>
        client.putSignedUrl(bucket, key, contentType, ttlSeconds),
      ),
    getSignedUrl: (bucket, key, ttlSeconds) =>
      withSpan(tracing.tracer, 'storage.get_signed_url', { 'storage.bucket': bucket }, () =>
        client.getSignedUrl(bucket, key, ttlSeconds),
      ),
    headObject: (bucket, key) =>
      withSpan(tracing.tracer, 'storage.head_object', { 'storage.bucket': bucket }, () =>
        client.headObject(bucket, key),
      ),
    putObject: (bucket, key, body, contentType) =>
      withSpan(tracing.tracer, 'storage.put_object', { 'storage.bucket': bucket }, () =>
        client.putObject(bucket, key, body, contentType),
      ),
    getObject: (bucket, key) =>
      withSpan(tracing.tracer, 'storage.get_object', { 'storage.bucket': bucket }, () =>
        client.getObject(bucket, key),
      ),
  };
}

export interface ModuleDependencies {
  /** Injectable so tests can supply a pre-built client (mocked send) instead of a real S3Client. */
  storage?: StorageClient;
  /** Injectable job queue (T28). Omitted entirely = automatic compaction (VER-01) stays inactive — a legitimate degrade path, not a boot requirement. */
  jobs?: JobQueue;
  /** Injectable so tests can supply a fake/deterministic broadcaster instead of the real config.redisUrl-driven choice below (T81). */
  presence?: PresenceBroadcaster;
}

/**
 * Wires every feature module onto the real Fastify instance. This is the one
 * place production boot (index.ts) and integration tests share, so a route
 * proven here is proven reachable the same way it will be in production —
 * never only through a hand-rolled per-module test registration.
 */
export async function registerAllModules(
  app: FastifyInstance,
  db: Db,
  config: AppConfig,
  deps: ModuleDependencies = {},
): Promise<void> {
  // OBS-01 (T91): `buildServer` always decorates `app.metrics` (a fresh
  // `MetricsRegistry` by default) before this function runs — every call
  // site in this codebase calls `buildServer` first. Read back here (never
  // constructed anew) so every module below observes into the SAME
  // registry `GET /metrics` serves.
  const metrics = app.metrics;
  // OBS-02 (T92): same reasoning as `metrics` above — `buildServer` always
  // decorates `app.tracing` (a fresh `Tracing` by default), read back here
  // so every module below emits spans into the SAME `BasicTracerProvider`
  // (fragmenting across multiple providers would break trace chaining —
  // e.g. `ai.run`'s children would never share a `traceId` with a REST
  // request's `http.request` span if `ai-engine` built its own provider).
  const tracing = app.tracing;
  const storage = wrapStorageWithTracing(
    deps.storage ?? createStorageClient(createS3Client(config)),
    tracing,
  );

  // AD-009/T81: RedisPresenceBroadcaster when config.redisUrl is set,
  // InMemoryPresenceBroadcaster (single-process, zero external I/O)
  // otherwise — the server always boots and works fully without Redis,
  // presence just stays scoped to this one process (AD-003).
  const presence: PresenceBroadcaster =
    deps.presence ??
    (config.redisUrl
      ? new RedisPresenceBroadcaster(config.redisUrl)
      : new InMemoryPresenceBroadcaster());

  // registerAuthModule is async (it awaits app.register(fastifyCookie) internally) —
  // must be awaited before the other modules register, or its routes and the
  // cookie plugin race app.ready() and the server hangs waiting on Fastify's
  // avvio boot graph to settle. registerWsGatewayModule is likewise async
  // (it awaits app.register(@fastify/websocket) internally, T73) — same
  // reasoning, awaited before the routes below.
  await registerAuthModule(app, { db, config });
  registerWorkspaceModule(app, { db, jobs: deps.jobs });
  registerDiagramSyncModule(app, { db, jobs: deps.jobs, metrics, tracing });
  registerAssetModule(app, { db, storage });
  registerSnapshotModule(app, { db, storage });
  registerExportModule(app, { db, storage, jobs: deps.jobs, metrics });
  registerInteropModule(app, { db, storage, jobs: deps.jobs });
  registerLibraryModule(app, { db });
  registerAiProviderModule(app, { db, encryptionKey: config.encryptionKey });
  registerAiEngineModule(app, {
    db,
    encryptionKey: config.encryptionKey,
    storage,
    metrics,
    tracing,
  });
  registerDocgenModule(app, { db, storage, jobs: deps.jobs });
  registerLintModule(app, { db });
  registerPresentationModule(app, { db });
  registerPresentationPublishModule(app, { db, storage, jobs: deps.jobs });
  registerCommentModule(app, { db, jobs: deps.jobs });
  registerShareModule(app, { db });
  registerWebhookModule(app, { db, encryptionKey: config.encryptionKey });
  await registerWsGatewayModule(app, { db, jobs: deps.jobs, presence, metrics, tracing });

  if (deps.jobs) {
    await registerCompactionJob(deps.jobs, db, storage, metrics);
    await registerBulkBundleJob(deps.jobs, db, storage);
    await registerWebhookDeliveryJob(deps.jobs, db, config.encryptionKey);

    // OBS-01 (T91): wires the live job-queue-depth gauge's sampler onto
    // every queue THIS wave registers a worker for. T90's
    // `backup-restore-test` job is deliberately NOT registered here yet
    // (its own registration is T96's job, same precedent T79/T80's webhook
    // module already established) — its queue name is added to this list
    // by T96 alongside its `registerRestoreTestJob` call.
    metrics.setJobQueueDepthSource(deps.jobs, [
      COMPACT_DIAGRAM_JOB,
      BULK_WORKSPACE_BUNDLE_JOB,
      WEBHOOK_DELIVERY_JOB,
    ]);
  }
}
