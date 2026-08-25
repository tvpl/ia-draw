import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractServerRoutes } from './serverRoutes.js';

/**
 * EDGE-10..12: the three descriptions of "which paths belong to `apps/server`" and the
 * comparison that keeps them identical.
 *
 * The two HTTP edges cannot share code — Caddy runs no JavaScript — so the guarantee has to
 * come from a test that reads all three and requires the same set. Without it, `/api` sat
 * in the `Caddyfile` matching nothing for weeks while the dev proxy had already been fixed
 * to route the real prefixes, and nothing anywhere reported the divergence.
 */

/** Registered paths that exist only to exercise the server's own error handling. */
const TEST_ONLY_PATH_PREFIXES = ['/__', '/x', '/zod-throws'];

/** Reduces a registered path to the prefix an edge matches on: `/users:lookup` -> `/users`. */
export function toEdgePrefix(routePath: string): string {
  const [, firstSegment = ''] = routePath.split('/');
  const [beforeColon = ''] = firstSegment.split(':');
  return `/${beforeColon}`;
}

function isTestOnly(routePath: string): boolean {
  return TEST_ONLY_PATH_PREFIXES.some((prefix) => routePath.startsWith(prefix));
}

/** Every prefix the server actually registers a route under, test-only routes excluded. */
export function prefixesFromRoutes(repoRoot: string): Set<string> {
  const prefixes = new Set<string>();
  for (const route of extractServerRoutes(repoRoot)) {
    if (isTestOnly(route.path)) continue;
    prefixes.add(toEdgePrefix(route.path));
  }
  return prefixes;
}

/**
 * Every prefix the compose proxy forwards to `server`. Throws rather than returning an
 * empty set when the file cannot be read or contains no forwarding rule at all: a silent
 * empty set would make the parity check pass by omission, which is the failure mode this
 * whole module exists to prevent (EDGE-12).
 */
export function prefixesFromCaddyfile(repoRoot: string): Set<string> {
  const path = join(repoRoot, 'infra/compose/Caddyfile');
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(`edge-parity: cannot read ${path}`, { cause });
  }

  const prefixes = new Set<string>();
  // `handle /auth* {` ... `reverse_proxy server:3000` — only blocks that forward to the
  // server count; the catch-all that forwards to `web` is not a server prefix.
  const blockPattern = /handle\s+(\/[^\s*{]*)\*?\s*\{([^}]*)\}/g;
  for (const match of source.matchAll(blockPattern)) {
    const [, prefix = '', body = ''] = match;
    if (body.includes('server:3000')) prefixes.add(prefix);
  }

  if (prefixes.size === 0) {
    throw new Error(`edge-parity: no server-forwarding handle found in ${path}`);
  }
  return prefixes;
}

/**
 * Every prefix the Vite dev server proxies. Read from the config source rather than by
 * importing it, so this module stays dependency-free and usable from the audit CLI.
 * Throws on an unreadable or unrecognisable config, for the same reason as above.
 */
export function prefixesFromViteConfig(
  repoRoot: string,
  declaredPrefixes: readonly string[],
  wsPrefix: string,
): Set<string> {
  const path = join(repoRoot, 'apps/web/vite.config.ts');
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(`edge-parity: cannot read ${path}`, { cause });
  }

  // The config is required to build its proxy map from the shared list rather than from a
  // literal of its own — that IS the contract (EDGE-06). A config that restated the
  // prefixes inline would drift again, so anything else is a failure, not a different set.
  // Matching the IMPORT, not merely a mention of the identifier: a local
  // `const SERVER_ROUTE_PREFIXES = [...]` satisfies a substring check while reintroducing
  // exactly the drift this guards against (found by the discrimination sensor).
  const imported =
    /import\s*\{([^}]*)\}\s*from\s*'@arch-canvas\/shared-contracts'/.exec(source)?.[1] ?? '';
  if (!imported.includes('SERVER_ROUTE_PREFIXES')) {
    throw new Error(
      `edge-parity: ${path} does not import SERVER_ROUTE_PREFIXES from @arch-canvas/shared-contracts`,
    );
  }
  if (!imported.includes('WS_ROUTE_PREFIX')) {
    throw new Error(
      `edge-parity: ${path} does not import WS_ROUTE_PREFIX from @arch-canvas/shared-contracts`,
    );
  }
  return new Set([...declaredPrefixes, wsPrefix]);
}

export interface EdgeParityDifference {
  prefix: string;
  missingFrom: string;
}

/** Every prefix present in one description and absent from another, named on both sides. */
export function compareEdges(
  routes: ReadonlySet<string>,
  caddy: ReadonlySet<string>,
  vite: ReadonlySet<string>,
): EdgeParityDifference[] {
  const differences: EdgeParityDifference[] = [];
  for (const prefix of routes) {
    if (!caddy.has(prefix)) differences.push({ prefix, missingFrom: 'infra/compose/Caddyfile' });
    if (!vite.has(prefix)) differences.push({ prefix, missingFrom: 'apps/web/vite.config.ts' });
  }
  for (const prefix of caddy) {
    if (!routes.has(prefix)) {
      differences.push({ prefix, missingFrom: 'apps/server (dead rule in the Caddyfile)' });
    }
  }
  return differences;
}
