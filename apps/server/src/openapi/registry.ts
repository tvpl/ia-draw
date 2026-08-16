import { routeSchemas as coreRouteSchemas } from '../core/server.js';
import { routeSchemas as aiEngineRouteSchemas } from '../modules/ai-engine/routes.js';
import { routeSchemas as aiProviderRouteSchemas } from '../modules/ai-provider/routes.js';
import { routeSchemas as assetRouteSchemas } from '../modules/asset/routes.js';
import { routeSchemas as authRouteSchemas } from '../modules/auth/routes.js';
import { routeSchemas as commentRouteSchemas } from '../modules/comment/routes.js';
import { routeSchemas as diagramSyncRouteSchemas } from '../modules/diagram-sync/routes.js';
import { routeSchemas as docgenRouteSchemas } from '../modules/docgen/routes.js';
import { routeSchemas as exportRouteSchemas } from '../modules/export/routes.js';
import { routeSchemas as interopRouteSchemas } from '../modules/interop/routes.js';
import { routeSchemas as libraryRouteSchemas } from '../modules/library/routes.js';
import { routeSchemas as lintRouteSchemas } from '../modules/lint/routes.js';
import { routeSchemas as mcpRouteSchemas } from '../modules/mcp/routes.js';
import { routeSchemas as presentationPublishRouteSchemas } from '../modules/presentation/publishRoutes.js';
import { routeSchemas as presentationRouteSchemas } from '../modules/presentation/routes.js';
import { routeSchemas as shareRouteSchemas } from '../modules/share/routes.js';
import { routeSchemas as snapshotRouteSchemas } from '../modules/snapshot/routes.js';
import { routeSchemas as webhookRouteSchemas } from '../modules/webhook/routes.js';
import { routeSchemas as workspaceProjectDiagramRouteSchemas } from '../modules/workspace/project-diagram-routes.js';
import { routeSchemas as workspaceRouteSchemas } from '../modules/workspace/routes.js';
import { routeSchemas as wsGatewayRouteSchemas } from '../modules/ws-gateway/routes.js';
import type { RouteSchemaMap } from './types.js';

/**
 * Aggregates every module's `routeSchemas` export (T3, API-01) into one
 * registry keyed by module name, ready for `buildOpenApiDocument`. Grows by
 * one entry per module as the `routeSchemas` pattern spreads (T5-T20).
 */
export const registry: Record<string, RouteSchemaMap> = {
  'ai-engine': aiEngineRouteSchemas,
  'ai-provider': aiProviderRouteSchemas,
  asset: assetRouteSchemas,
  auth: authRouteSchemas,
  comment: commentRouteSchemas,
  core: coreRouteSchemas,
  'diagram-sync': diagramSyncRouteSchemas,
  docgen: docgenRouteSchemas,
  export: exportRouteSchemas,
  interop: interopRouteSchemas,
  library: libraryRouteSchemas,
  lint: lintRouteSchemas,
  mcp: mcpRouteSchemas,
  presentation: presentationRouteSchemas,
  'presentation-publish': presentationPublishRouteSchemas,
  share: shareRouteSchemas,
  snapshot: snapshotRouteSchemas,
  webhook: webhookRouteSchemas,
  workspace: workspaceRouteSchemas,
  'workspace-project-diagram': workspaceProjectDiagramRouteSchemas,
  'ws-gateway': wsGatewayRouteSchemas,
};
