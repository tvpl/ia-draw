import { describe, expect, it } from 'vitest';
import { buildRouteInventory } from './routeInventory.js';
import type { ServerRoute } from './serverRoutes.js';
import type { WebConsumer } from './webConsumers.js';

function route(method: string, path: string): ServerRoute {
  return { method, path, file: 'apps/server/src/modules/example/routes.ts' };
}

function consumer(path: string, file = 'apps/web/src/sync/syncClient.ts'): WebConsumer {
  return { path, expression: `'${path}'`, file, resolvable: true };
}

describe('buildRouteInventory (UIX-01, UIX-04)', () => {
  it('classifies a route the UI requests as consumed and names the consuming file', () => {
    const inventory = buildRouteInventory(
      [route('GET', '/me')],
      [consumer('/me', 'apps/web/src/diagram/DiagramEditorPage.tsx')],
    );

    expect(inventory.routes).toEqual([
      {
        method: 'GET',
        path: '/me',
        file: 'apps/server/src/modules/example/routes.ts',
        classification: 'consumed',
        consumedBy: ['apps/web/src/diagram/DiagramEditorPage.tsx'],
      },
    ]);
  });

  it('classifies a route with no UI consumer as pending-product (UIX-04)', () => {
    const inventory = buildRouteInventory([route('GET', '/diagrams/:id/lint')], []);

    expect(inventory.routes[0]?.classification).toBe('pending-product');
    expect(inventory.routes[0]?.consumedBy).toEqual([]);
  });

  it('gives every route exactly one classification, with no escape category', () => {
    const routes = [route('GET', '/me'), route('GET', '/libraries'), route('POST', '/workspaces')];

    const inventory = buildRouteInventory(routes, [consumer('/me')]);

    expect(inventory.routes).toHaveLength(routes.length);
    expect(inventory.routes.map((entry) => entry.classification)).toEqual([
      'consumed',
      'pending-product',
      'pending-product',
    ]);
  });

  it('keeps consumed plus pending-product equal to the total number of routes', () => {
    const routes = [
      route('GET', '/me'),
      route('GET', '/diagrams/:id/bootstrap'),
      route('GET', '/diagrams/:id/lint'),
      route('POST', '/presentations'),
      route('DELETE', '/workspaces/:id'),
    ];

    const inventory = buildRouteInventory(routes, [
      consumer('/me'),
      consumer('/diagrams/:param/bootstrap'),
    ]);

    expect(inventory.totals.consumed).toBe(2);
    expect(inventory.totals.pendingProduct).toBe(3);
    expect(inventory.totals.consumed + inventory.totals.pendingProduct).toBe(routes.length);
    expect(inventory.totals.routes).toBe(routes.length);
  });

  it('reports a consumer pointing at an unregistered route as orphan-consumer', () => {
    const inventory = buildRouteInventory(
      [route('GET', '/me')],
      [consumer('/me'), consumer('/diagrams/:param/ghost', 'apps/web/src/sync/ghost.ts')],
    );

    expect(inventory.orphanConsumers).toEqual([
      {
        path: '/diagrams/:param/ghost',
        expression: "'/diagrams/:param/ghost'",
        file: 'apps/web/src/sync/ghost.ts',
        resolvable: true,
        classification: 'orphan-consumer',
      },
    ]);
  });

  it('matches a parameterized route against the consumer that interpolates it', () => {
    const inventory = buildRouteInventory(
      [route('POST', '/diagrams/:id/operations:batch')],
      [consumer('/diagrams/:param/operations:batch')],
    );

    expect(inventory.routes[0]?.classification).toBe('consumed');
    expect(inventory.orphanConsumers).toEqual([]);
  });

  it('leaves a route whose path merely resembles a consumed one as pending-product', () => {
    const inventory = buildRouteInventory(
      [route('POST', '/diagrams/:id/operations:batch'), route('GET', '/diagrams/:id/operations')],
      [consumer('/diagrams/:param/operations:batch')],
    );

    expect(inventory.routes.map((entry) => entry.classification)).toEqual([
      'consumed',
      'pending-product',
    ]);
  });
});
