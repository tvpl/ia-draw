import type { ZodType } from 'zod';

/**
 * One route's request/response schemas, keyed by the same `"METHOD path"`
 * string `extractServerRoutes` (`tools/repo-tools`) already produces — e.g.
 * `"GET /admin/ai-providers"`. Every module's `routes.ts` exports one of
 * these (see `apps/server/src/modules/ai-provider/routes.ts`), pointing at
 * the same Zod objects the handler already calls `.parse()` with, so the
 * OpenAPI generator (`buildDocument.ts`) has real fidelity without any
 * route changing behavior (API-01).
 */
export type RouteSchemaMap = Record<
  string,
  {
    query?: ZodType;
    params?: ZodType;
    body?: ZodType;
    response?: ZodType;
    /**
     * Marks a WebSocket upgrade route (e.g. `ws-gateway`) instead of a JSON
     * REST route — the generator documents it without inventing a
     * request/response JSON schema that does not exist.
     */
    websocket?: true;
  }
>;
