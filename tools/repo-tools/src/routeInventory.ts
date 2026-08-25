import type { ServerRoute } from './serverRoutes.js';
import type { WebConsumer } from './webConsumers.js';

/** The only two states a registered route can be in. There is no escape category. */
export type RouteClassification = 'consumed' | 'pending-product';

/** One registered route plus the UI surface that requests it. */
export interface RouteInventoryEntry extends ServerRoute {
  classification: RouteClassification;
  /** Files under `apps/web/src` that request this route; empty when pending. */
  consumedBy: string[];
}

/** A UI call that matches no registered route — reported, never dropped. */
export interface OrphanConsumer extends WebConsumer {
  classification: 'orphan-consumer';
}

export interface RouteInventory {
  routes: RouteInventoryEntry[];
  orphanConsumers: OrphanConsumer[];
  totals: {
    routes: number;
    consumed: number;
    pendingProduct: number;
    orphanConsumers: number;
  };
}

function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/**
 * Rewrites every parameter name to the same placeholder so two spellings of the same
 * route compare equal. Needed for parameters that are not a whole segment: the interop
 * routes register `/diagrams/:id/export:format`, where `:format` is a parameter glued to
 * the literal text `export`, and no amount of whole-segment wildcarding matches that.
 */
function normalizeParams(segment: string): string {
  return segment.replace(/:[A-Za-z_$][A-Za-z0-9_$]*/g, ':param');
}

/**
 * A route matches a consumer when they have the same segment count and every
 * segment is either identical or a parameter on one of the sides — `:id` on the
 * server against the `:param` the extractor writes for `${...}` interpolation.
 * Matching is path-based: a `fetch` call carries no method the extractor can
 * read, so a path with several methods counts as consumed for all of them.
 */
function matches(routePath: string, consumerPath: string): boolean {
  const routeParts = segments(routePath);
  const consumerParts = segments(consumerPath);
  if (routeParts.length !== consumerParts.length) return false;

  return routeParts.every((part, position) => {
    const other = consumerParts[position] ?? '';
    if (part.startsWith(':') || other.startsWith(':')) return true;
    return normalizeParams(part) === normalizeParams(other);
  });
}

/**
 * Crosses the registered routes with the endpoints the web app requests and
 * classifies each route as `consumed` or `pending-product` (UIX-01, UIX-04).
 * Consumers that match no route come back as `orphan-consumer` instead of being
 * silently discarded, so nothing on either side of the crossing is unaccounted
 * for.
 */
export function buildRouteInventory(
  routes: ServerRoute[],
  consumers: WebConsumer[],
): RouteInventory {
  const matched = new Set<WebConsumer>();

  const entries: RouteInventoryEntry[] = routes.map((route) => {
    const consumedBy: string[] = [];
    for (const consumer of consumers) {
      if (!consumer.resolvable || !matches(route.path, consumer.path)) continue;
      matched.add(consumer);
      if (!consumedBy.includes(consumer.file)) consumedBy.push(consumer.file);
    }
    return {
      ...route,
      classification: consumedBy.length > 0 ? 'consumed' : 'pending-product',
      consumedBy,
    };
  });

  const orphanConsumers: OrphanConsumer[] = consumers
    .filter((consumer) => !matched.has(consumer))
    .map((consumer) => ({ ...consumer, classification: 'orphan-consumer' }));

  const consumed = entries.filter((entry) => entry.classification === 'consumed').length;

  return {
    routes: entries,
    orphanConsumers,
    totals: {
      routes: entries.length,
      consumed,
      pendingProduct: entries.length - consumed,
      orphanConsumers: orphanConsumers.length,
    },
  };
}

/** DOCS-01: the delimiters the README's generated counts live between. */
export const README_BLOCK_START = '<!-- repo-tools:counts:start -->';
export const README_BLOCK_END = '<!-- repo-tools:counts:end -->';

export interface CapabilityCounts {
  total: number;
  withSurface: number;
}

/**
 * DOCS-01/02: the counts block, rendered from measurement.
 *
 * Only the block is generated. The prose around it stays hand-written and reviewed, because
 * prose ages better when a person writes it and numbers age worse when a person types them
 * — the README claimed 82 routes and 4 consumers while the audit measured 92 and 67.
 */
export function renderReadmeCounts(
  inventory: RouteInventory,
  capabilities: CapabilityCounts,
): string {
  return [
    README_BLOCK_START,
    `- **Capacidades:** ${capabilities.total} no total, ${capabilities.withSurface} com tela, ` +
      `${capabilities.total - capabilities.withSurface} ainda sem superfície.`,
    `- **Rotas REST:** ${inventory.totals.routes} registradas, ${inventory.totals.consumed} ` +
      `consumidas pela interface, ${inventory.totals.pendingProduct} sem consumidor.`,
    '',
    '<sub>Bloco gerado por `repo-tools audit`. Não edite à mão: o gate compara o que está aqui',
    'com o que ele mede e falha na divergência.</sub>',
    README_BLOCK_END,
  ].join('\n');
}

export interface ReadmeCountsViolation {
  entry: string;
  problem: string;
}

/**
 * Rewrites the README's counts block in place and reports a violation when the file could
 * not be read, has no block, or held something other than the measured counts.
 */
export function syncReadmeCounts(
  readmePath: string,
  expected: string,
  read: (path: string) => string,
  write: (path: string, contents: string) => void,
): ReadmeCountsViolation[] {
  let readme: string;
  try {
    readme = read(readmePath);
  } catch {
    return [{ entry: 'README.md', problem: 'could not be read' }];
  }

  const start = readme.indexOf(README_BLOCK_START);
  const end = readme.indexOf(README_BLOCK_END);
  if (start === -1 || end === -1 || end < start) {
    return [
      {
        entry: 'README.md',
        problem: `missing the ${README_BLOCK_START} … ${README_BLOCK_END} block`,
      },
    ];
  }

  const current = readme.slice(start, end + README_BLOCK_END.length);
  if (current === expected) return [];

  write(
    readmePath,
    readme.slice(0, start) + expected + readme.slice(end + README_BLOCK_END.length),
  );
  return [
    {
      entry: 'README.md',
      problem: 'counts block did not match the measured values — rewritten, commit the change',
    },
  ];
}
