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
    return part.startsWith(':') || other.startsWith(':') || part === other;
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
