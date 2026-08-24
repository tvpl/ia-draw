/**
 * EDGE-09: the single declaration of which path prefixes belong to `apps/server`.
 *
 * Two HTTP edges decide "is this the API or the SPA?" — Caddy in the compose stack
 * (`infra/compose/Caddyfile`) and Vite's dev proxy (`apps/web/vite.config.ts`). They used
 * to answer differently and both answered wrong: Caddy forwarded `/api/*`, a namespace no
 * route has ever used, so every API call in the Docker stack fell through to the SPA and
 * `POST /auth/login` came back as a 405 from nginx. The dev proxy had found the same
 * divergence and fixed only itself, while still omitting seven prefixes.
 *
 * Vite imports this list directly. Caddy cannot run JavaScript, so its config stays
 * hand-written — `tools/repo-tools`' edge-parity test is what keeps the two in step, by
 * requiring the registered routes, the `Caddyfile` and the dev proxy to describe exactly
 * the same set.
 *
 * The routes themselves stay unprefixed (no `/api`): prefixing 90 routes would break
 * `docs/openapi.json`, the MCP module and every external consumer, which is far more than
 * an edge-routing defect is worth.
 */
export const SERVER_ROUTE_PREFIXES: readonly string[] = [
  '/admin',
  '/ai',
  '/auth',
  '/diagrams',
  '/health',
  '/libraries',
  '/mcp-tokens',
  '/me',
  '/metrics',
  '/presentations',
  '/projects',
  '/share',
  // Covers `/users:lookup`. Both edges match by path prefix, and a literal colon in a
  // match expression is fragile in Caddy and in Vite alike.
  '/users',
  '/workspaces',
];

/**
 * The WebSocket route prefix, kept separate because it is an upgrade rather than a plain
 * HTTP request: Caddy needs no special handling but Vite's proxy requires `ws: true`, so a
 * caller that treats it like the list above silently ends up with a dev server that never
 * connects (LIVE-06).
 */
export const WS_ROUTE_PREFIX = '/ws';
