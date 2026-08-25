import { describe, expect, it } from 'vitest';
import {
  buildRouteInventory,
  README_BLOCK_END,
  README_BLOCK_START,
  type RouteInventory,
  renderReadmeCounts,
  syncReadmeCounts,
} from './routeInventory.js';
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

/** A three-route inventory, one consumed — enough to render a counts block from. */
function inventoryOf(): RouteInventory {
  return buildRouteInventory(
    [route('GET', '/me'), route('GET', '/lint'), route('POST', '/presentations')],
    [consumer('/me')],
  );
}

describe('renderReadmeCounts (DOCS-01, DOCS-02)', () => {
  it('states the measured capability and route counts, and the derived remainders', () => {
    const block = renderReadmeCounts(inventoryOf(), { total: 27, withSurface: 21 });

    expect(block).toContain('- **Capacidades:** 27 no total, 21 com tela, 6 ainda sem superfície.');
    expect(block).toContain(
      '- **Rotas REST:** 3 registradas, 1 consumidas pela interface, 2 sem consumidor.',
    );
  });

  it('wraps the counts in the delimiters the sync looks for', () => {
    const block = renderReadmeCounts(inventoryOf(), { total: 27, withSurface: 21 });

    expect(block.startsWith(README_BLOCK_START)).toBe(true);
    expect(block.endsWith(README_BLOCK_END)).toBe(true);
  });
});

describe('syncReadmeCounts (DOCS-01, DOCS-03)', () => {
  const expected = `${README_BLOCK_START}\n- **Rotas REST:** 3 registradas.\n${README_BLOCK_END}`;

  function readmeWith(block: string): string {
    return `# Título\n\nprosa antes\n\n${block}\n\nprosa depois\n`;
  }

  it('reports nothing and writes nothing when the block already matches', () => {
    const writes: string[] = [];

    const violations = syncReadmeCounts(
      'README.md',
      expected,
      () => readmeWith(expected),
      (_path, contents) => writes.push(contents),
    );

    expect(violations).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('rewrites only the block, keeping the prose on both sides, and reports the drift', () => {
    const stale = `${README_BLOCK_START}\n- **Rotas REST:** 82 registradas.\n${README_BLOCK_END}`;
    const writes: string[] = [];

    const violations = syncReadmeCounts(
      'README.md',
      expected,
      () => readmeWith(stale),
      (_path, contents) => writes.push(contents),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.entry).toBe('README.md');
    expect(writes[0]).toBe(readmeWith(expected));
    expect(writes[0]).toContain('prosa antes');
    expect(writes[0]).toContain('prosa depois');
    expect(writes[0]).not.toContain('82 registradas');
  });

  it('reports a README with no block instead of appending one silently', () => {
    const writes: string[] = [];

    const violations = syncReadmeCounts(
      'README.md',
      expected,
      () => '# Título\n\nsem bloco\n',
      (_path, contents) => writes.push(contents),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.problem).toContain(README_BLOCK_START);
    expect(writes).toEqual([]);
  });

  it('reports a README it cannot read instead of throwing', () => {
    const violations = syncReadmeCounts(
      'README.md',
      expected,
      () => {
        throw new Error('ENOENT');
      },
      () => {
        throw new Error('should not write');
      },
    );

    expect(violations).toEqual([{ entry: 'README.md', problem: 'could not be read' }]);
  });
});
