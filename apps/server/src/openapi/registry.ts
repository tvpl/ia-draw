import { routeSchemas as aiProviderRouteSchemas } from '../modules/ai-provider/routes.js';
import { routeSchemas as authRouteSchemas } from '../modules/auth/routes.js';
import type { RouteSchemaMap } from './types.js';

/**
 * Aggregates every module's `routeSchemas` export (T3, API-01) into one
 * registry keyed by module name, ready for `buildOpenApiDocument`. Grows by
 * one entry per module as the `routeSchemas` pattern spreads (T5-T20).
 */
export const registry: Record<string, RouteSchemaMap> = {
  'ai-provider': aiProviderRouteSchemas,
  auth: authRouteSchemas,
};
