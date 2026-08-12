import type { FastifyInstance } from 'fastify';
import { registerAssetModule } from '../modules/asset/routes.js';
import type { Db } from '../modules/auth/db.js';
import { registerAuthModule } from '../modules/auth/routes.js';
import { registerDiagramSyncModule } from '../modules/diagram-sync/routes.js';
import { createS3Client } from '../modules/storage/client.js';
import { createStorageClient, type StorageClient } from '../modules/storage/signedUrl.js';
import { registerWorkspaceModule } from '../modules/workspace/routes.js';
import type { AppConfig } from './config.js';

export interface ModuleDependencies {
  /** Injectable so tests can supply a pre-built client (mocked send) instead of a real S3Client. */
  storage?: StorageClient;
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
  registerDiagramSyncModule(app, { db });
  registerAssetModule(app, { db, storage });
}
