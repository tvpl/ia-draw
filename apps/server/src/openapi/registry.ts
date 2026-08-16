import { routeSchemas as aiProviderRouteSchemas } from '../modules/ai-provider/routes.js';
import { routeSchemas as assetRouteSchemas } from '../modules/asset/routes.js';
import { routeSchemas as authRouteSchemas } from '../modules/auth/routes.js';
import { routeSchemas as commentRouteSchemas } from '../modules/comment/routes.js';
import { routeSchemas as diagramSyncRouteSchemas } from '../modules/diagram-sync/routes.js';
import { routeSchemas as docgenRouteSchemas } from '../modules/docgen/routes.js';
import { routeSchemas as exportRouteSchemas } from '../modules/export/routes.js';
import { routeSchemas as shareRouteSchemas } from '../modules/share/routes.js';
import { routeSchemas as snapshotRouteSchemas } from '../modules/snapshot/routes.js';
import { routeSchemas as workspaceRouteSchemas } from '../modules/workspace/routes.js';
import type { RouteSchemaMap } from './types.js';

/**
 * Aggregates every module's `routeSchemas` export (T3, API-01) into one
 * registry keyed by module name, ready for `buildOpenApiDocument`. Grows by
 * one entry per module as the `routeSchemas` pattern spreads (T5-T20).
 */
export const registry: Record<string, RouteSchemaMap> = {
  'ai-provider': aiProviderRouteSchemas,
  asset: assetRouteSchemas,
  auth: authRouteSchemas,
  comment: commentRouteSchemas,
  'diagram-sync': diagramSyncRouteSchemas,
  docgen: docgenRouteSchemas,
  export: exportRouteSchemas,
  share: shareRouteSchemas,
  snapshot: snapshotRouteSchemas,
  workspace: workspaceRouteSchemas,
};
