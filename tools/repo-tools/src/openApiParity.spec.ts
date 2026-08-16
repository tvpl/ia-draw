import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkOpenApiParity } from './openApiParity.js';

let scratch: string | undefined;

/** Builds a throwaway repo root whose `path -> contents` files are written verbatim. */
function fakeRepo(files: Record<string, string>): string {
  scratch = mkdtempSync(join(tmpdir(), 'repo-tools-openapi-parity-'));
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = join(scratch, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, 'utf8');
  }
  return scratch;
}

const CLEAN_DOC = JSON.stringify({
  openapi: '3.1.0',
  info: { title: 'x', version: '1.0.0' },
  paths: {
    '/diagrams/{id}/lint': { get: { responses: { '200': { description: 'ok' } } } },
  },
});

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

describe('checkOpenApiParity (API-02)', () => {
  it('fails naming the exact route when a registered route has no OpenAPI entry', () => {
    const root = fakeRepo({
      'apps/server/src/modules/lint/routes.ts': "app.get('/diagrams/:id/lint', handler);",
      'docs/openapi.json': JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'x', version: '1.0.0' },
        paths: { '/workspaces': { get: { responses: { '200': { description: 'ok' } } } } },
      }),
    });

    const violations = checkOpenApiParity(root);

    expect(violations).toContainEqual({
      entry: 'GET /diagrams/:id/lint',
      problem:
        'registered in apps/server/src/modules/lint/routes.ts but has no entry in docs/openapi.json',
    });
  });

  it('fails naming the exact entry when an OpenAPI entry has no matching real route', () => {
    const root = fakeRepo({
      'apps/server/src/modules/lint/routes.ts': "app.get('/diagrams/:id/lint', handler);",
      'docs/openapi.json': JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'x', version: '1.0.0' },
        paths: {
          '/diagrams/{id}/lint': { get: { responses: { '200': { description: 'ok' } } } },
          '/ghost': { post: { responses: { '200': { description: 'ok' } } } },
        },
      }),
    });

    const violations = checkOpenApiParity(root);

    expect(violations).toContainEqual({
      entry: 'POST /ghost',
      problem: 'documented in docs/openapi.json but no matching route is registered',
    });
  });

  it('fails explicitly when docs/openapi.json is missing or declares no route', () => {
    const missing = fakeRepo({
      'apps/server/src/modules/lint/routes.ts': "app.get('/diagrams/:id/lint', handler);",
    });
    expect(checkOpenApiParity(missing)).toEqual([
      { entry: 'docs/openapi.json', problem: 'no OpenAPI document found at docs/openapi.json' },
    ]);

    const empty = fakeRepo({
      'apps/server/src/modules/lint/routes.ts': "app.get('/diagrams/:id/lint', handler);",
      'docs/openapi.json': JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'x', version: '1.0.0' },
        paths: {},
      }),
    });
    expect(checkOpenApiParity(empty)).toEqual([
      {
        entry: 'docs/openapi.json',
        problem: 'docs/openapi.json declares no route, so it proves nothing',
      },
    ]);
  });

  it('passes with no violations when every real route has a matching documented entry and vice versa', () => {
    const root = fakeRepo({
      'apps/server/src/modules/lint/routes.ts': "app.get('/diagrams/:id/lint', handler);",
      'docs/openapi.json': CLEAN_DOC,
    });

    expect(checkOpenApiParity(root)).toEqual([]);
  });
});
