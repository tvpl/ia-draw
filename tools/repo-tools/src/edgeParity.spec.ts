import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVER_ROUTE_PREFIXES, WS_ROUTE_PREFIX } from '@arch-canvas/shared-contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  compareEdges,
  prefixesFromCaddyfile,
  prefixesFromRoutes,
  prefixesFromViteConfig,
  toEdgePrefix,
} from './edgeParity.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const scratchDirs: string[] = [];

function scratch(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'edge-parity-'));
  scratchDirs.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = join(root, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, 'utf8');
  }
  return root;
}

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('toEdgePrefix', () => {
  it('reduces a nested path to its first segment', () => {
    expect(toEdgePrefix('/diagrams/:id/bootstrap')).toBe('/diagrams');
  });

  it('drops the colon suffix so /users:lookup matches by prefix (EDGE-08 edge case)', () => {
    expect(toEdgePrefix('/users:lookup')).toBe('/users');
  });

  it('leaves a single-segment path unchanged', () => {
    expect(toEdgePrefix('/metrics')).toBe('/metrics');
  });
});

describe('prefixesFromCaddyfile (EDGE-12)', () => {
  it('collects only the handles that forward to the server', () => {
    const root = scratch({
      'infra/compose/Caddyfile': [
        ':80 {',
        '\thandle /auth* {',
        '\t\treverse_proxy server:3000',
        '\t}',
        '',
        '\thandle {',
        '\t\treverse_proxy web:80',
        '\t}',
        '}',
      ].join('\n'),
    });

    expect(prefixesFromCaddyfile(root)).toEqual(new Set(['/auth']));
  });

  it('throws when the file cannot be read, never returns an empty set', () => {
    const root = scratch({ 'placeholder.txt': 'x' });

    expect(() => prefixesFromCaddyfile(root)).toThrowError(/cannot read/);
  });

  it('throws when no handle forwards to the server', () => {
    const root = scratch({
      'infra/compose/Caddyfile': ':80 {\n\thandle {\n\t\treverse_proxy web:80\n\t}\n}',
    });

    expect(() => prefixesFromCaddyfile(root)).toThrowError(/no server-forwarding handle/);
  });
});

describe('prefixesFromViteConfig (EDGE-12)', () => {
  it('throws when the config restates the prefixes instead of importing them', () => {
    const root = scratch({
      'apps/web/vite.config.ts': "export default { server: { proxy: { '/auth': {} } } };",
    });

    expect(() => prefixesFromViteConfig(root, SERVER_ROUTE_PREFIXES, WS_ROUTE_PREFIX)).toThrowError(
      /does not import SERVER_ROUTE_PREFIXES/,
    );
  });

  it('throws when the websocket prefix is not imported', () => {
    const root = scratch({
      'apps/web/vite.config.ts':
        "import { SERVER_ROUTE_PREFIXES } from '@arch-canvas/shared-contracts';",
    });

    expect(() => prefixesFromViteConfig(root, SERVER_ROUTE_PREFIXES, WS_ROUTE_PREFIX)).toThrowError(
      /does not import WS_ROUTE_PREFIX/,
    );
  });

  it('rejects a local redefinition that only mentions the identifier (EDGE-06)', () => {
    // A substring check passes this: the drift it guards against is exactly a config that
    // declares its own list under the same name. Found by the discrimination sensor.
    const root = scratch({
      'apps/web/vite.config.ts': "const SERVER_ROUTE_PREFIXES = ['/auth'];",
    });

    expect(() => prefixesFromViteConfig(root, SERVER_ROUTE_PREFIXES, WS_ROUTE_PREFIX)).toThrowError(
      /does not import SERVER_ROUTE_PREFIXES/,
    );
  });

  it('throws when the file cannot be read', () => {
    const root = scratch({ 'placeholder.txt': 'x' });

    expect(() => prefixesFromViteConfig(root, SERVER_ROUTE_PREFIXES, WS_ROUTE_PREFIX)).toThrowError(
      /cannot read/,
    );
  });
});

describe('compareEdges (EDGE-10, EDGE-11)', () => {
  it('names a prefix the Caddyfile is missing', () => {
    const differences = compareEdges(
      new Set(['/auth', '/share']),
      new Set(['/auth']),
      new Set(['/auth', '/share']),
    );

    expect(differences).toEqual([{ prefix: '/share', missingFrom: 'infra/compose/Caddyfile' }]);
  });

  it('names a prefix the dev proxy is missing', () => {
    const differences = compareEdges(
      new Set(['/auth', '/ai']),
      new Set(['/auth', '/ai']),
      new Set(['/auth']),
    );

    expect(differences).toEqual([{ prefix: '/ai', missingFrom: 'apps/web/vite.config.ts' }]);
  });

  it('names a dead edge rule with no registered route (EDGE-11 edge case)', () => {
    const differences = compareEdges(
      new Set(['/auth']),
      new Set(['/auth', '/api']),
      new Set(['/auth']),
    );

    expect(differences).toEqual([
      { prefix: '/api', missingFrom: 'apps/server (dead rule in the Caddyfile)' },
    ]);
  });
});

describe('the real repository (EDGE-10, EDGE-11)', () => {
  it('registers routes under at least one prefix', () => {
    // A zero here means the extractor broke, not that the server has no routes.
    expect(prefixesFromRoutes(REPO_ROOT).size).toBeGreaterThan(0);
  });

  it('describes the same prefix set in the routes, the Caddyfile and the dev proxy', () => {
    const routes = prefixesFromRoutes(REPO_ROOT);
    const caddy = prefixesFromCaddyfile(REPO_ROOT);
    const vite = prefixesFromViteConfig(REPO_ROOT, SERVER_ROUTE_PREFIXES, WS_ROUTE_PREFIX);

    expect(compareEdges(routes, caddy, vite)).toEqual([]);
  });

  it('declares in shared-contracts exactly the prefixes the server registers', () => {
    const routes = [...prefixesFromRoutes(REPO_ROOT)].sort();
    // The websocket prefix is declared separately because the dev proxy needs `ws: true`
    // for it; the server still registers routes under it, so it belongs in this comparison.
    const declared = [...SERVER_ROUTE_PREFIXES, WS_ROUTE_PREFIX].sort();

    expect(declared).toEqual(routes);
  });

  it('has no /api rule left in the Caddyfile (EDGE-05)', () => {
    expect(prefixesFromCaddyfile(REPO_ROOT).has('/api')).toBe(false);
  });
});
