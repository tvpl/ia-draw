import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { extractServerRoutes } from './serverRoutes.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let scratch: string | undefined;

/** Builds a throwaway repo root containing the given `path -> contents` files. */
function fakeRepo(files: Record<string, string>): string {
  scratch = mkdtempSync(join(tmpdir(), 'repo-tools-routes-'));
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = join(scratch, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, 'utf8');
  }
  return scratch;
}

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

describe('extractServerRoutes (UIX-01)', () => {
  it('returns method, path and source file for every registered route', () => {
    const root = fakeRepo({
      'apps/server/src/modules/auth/routes.ts': [
        "app.get('/me', { preHandler: requireSession(db) }, async (request) => {});",
        "app.post('/auth/login', async (request, reply) => {});",
      ].join('\n'),
    });

    expect(extractServerRoutes(root)).toEqual([
      { method: 'GET', path: '/me', file: 'apps/server/src/modules/auth/routes.ts' },
      { method: 'POST', path: '/auth/login', file: 'apps/server/src/modules/auth/routes.ts' },
    ]);
  });

  it('ignores *.spec.ts so unit-test fixtures never enter the inventory', () => {
    const root = fakeRepo({
      'apps/server/src/modules/lint/routes.ts': "app.get('/diagrams/:id/lint', handler);",
      'apps/server/src/modules/lint/routes.spec.ts': "app.get('/fixture-only', handler);",
    });

    const routes = extractServerRoutes(root);

    expect(routes).toEqual([
      { method: 'GET', path: '/diagrams/:id/lint', file: 'apps/server/src/modules/lint/routes.ts' },
    ]);
  });

  it('ignores *.int.spec.ts so integration-test fixtures never enter the inventory', () => {
    const root = fakeRepo({
      'apps/server/src/modules/share/routes.ts': "app.get('/share/:token', handler);",
      'apps/server/src/modules/share/routes.int.spec.ts': "app.post('/int-fixture', handler);",
    });

    const routes = extractServerRoutes(root);

    expect(routes).toEqual([
      { method: 'GET', path: '/share/:token', file: 'apps/server/src/modules/share/routes.ts' },
    ]);
  });

  it('returns an empty list instead of throwing when a file registers no route', () => {
    const root = fakeRepo({
      'apps/server/src/modules/webhook/service.ts': 'export function deliver() { return 1; }',
    });

    expect(extractServerRoutes(root)).toEqual([]);
  });

  it('counts the same path registered with different methods as distinct entries', () => {
    const root = fakeRepo({
      'apps/server/src/modules/workspace/routes.ts': [
        "app.get('/workspaces/:id', handler);",
        "app.patch('/workspaces/:id', handler);",
        "app.delete('/workspaces/:id', handler);",
      ].join('\n'),
    });

    const routes = extractServerRoutes(root);

    expect(routes).toHaveLength(3);
    expect(routes.map((route) => route.method)).toEqual(['GET', 'PATCH', 'DELETE']);
    expect(new Set(routes.map((route) => route.path))).toEqual(new Set(['/workspaces/:id']));
  });

  it('finds at least the 48 routes registered in the real repository today', () => {
    const routes = extractServerRoutes(REPO_ROOT);

    expect(routes.length).toBeGreaterThanOrEqual(48);
    expect(routes).toContainEqual({
      method: 'GET',
      path: '/me',
      file: 'apps/server/src/modules/auth/routes.ts',
    });
    expect(routes.every((route) => !route.file.includes('.spec.ts'))).toBe(true);
  });
});
