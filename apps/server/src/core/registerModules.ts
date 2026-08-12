import type { FastifyInstance } from 'fastify';
import { registerAiEngineModule } from '../modules/ai-engine/routes.js';
import { registerAiProviderModule } from '../modules/ai-provider/routes.js';
import { registerAssetModule } from '../modules/asset/routes.js';
import type { Db } from '../modules/auth/db.js';
import { registerAuthModule } from '../modules/auth/routes.js';
import { registerDiagramSyncModule } from '../modules/diagram-sync/routes.js';
import { registerDocgenModule } from '../modules/docgen/routes.js';
import { registerBulkBundleJob } from '../modules/export/bulkBundle.js';
import { registerExportModule } from '../modules/export/routes.js';
import { registerInteropModule } from '../modules/interop/routes.js';
import type { JobQueue } from '../modules/jobs/index.js';
import { registerLibraryModule } from '../modules/library/routes.js';
import { registerLintModule } from '../modules/lint/routes.js';
import { registerPresentationPublishModule } from '../modules/presentation/publishRoutes.js';
import { registerPresentationModule } from '../modules/presentation/routes.js';
import { registerCompactionJob } from '../modules/snapshot/compaction.js';
import { registerSnapshotModule } from '../modules/snapshot/routes.js';
import { createS3Client } from '../modules/storage/client.js';
import { createStorageClient, type StorageClient } from '../modules/storage/signedUrl.js';
import { registerWorkspaceModule } from '../modules/workspace/routes.js';
import type { AppConfig } from './config.js';

export interface ModuleDependencies {
  /** Injectable so tests can supply a pre-built client (mocked send) instead of a real S3Client. */
  storage?: StorageClient;
  /** Injectable job queue (T28). Omitted entirely = automatic compaction (VER-01) stays inactive — a legitimate degrade path, not a boot requirement. */
  jobs?: JobQueue;
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
  const storage = deps.storage ?? createStorageClient(createS3Client(config));

  // registerAuthModule is async (it awaits app.register(fastifyCookie) internally) —
  // must be awaited before the other modules register, or its routes and the
  // cookie plugin race app.ready() and the server hangs waiting on Fastify's
  // avvio boot graph to settle.
  await registerAuthModule(app, { db, config });
  registerWorkspaceModule(app, { db });
  registerDiagramSyncModule(app, { db, jobs: deps.jobs });
  registerAssetModule(app, { db, storage });
  registerSnapshotModule(app, { db, storage });
  registerExportModule(app, { db, storage, jobs: deps.jobs });
  registerInteropModule(app, { db, storage, jobs: deps.jobs });
  registerLibraryModule(app, { db });
  registerAiProviderModule(app, { db, encryptionKey: config.encryptionKey });
  registerAiEngineModule(app, { db, encryptionKey: config.encryptionKey, storage });
  registerDocgenModule(app, { db, storage });
  registerLintModule(app, { db });
  registerPresentationModule(app, { db });
  registerPresentationPublishModule(app, { db, storage });

  if (deps.jobs) {
    await registerCompactionJob(deps.jobs, db, storage);
    await registerBulkBundleJob(deps.jobs, db, storage);
  }
}
