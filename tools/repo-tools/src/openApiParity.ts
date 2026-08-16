import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractServerRoutes } from './serverRoutes.js';

/** One reason a route and the generated OpenAPI document disagree. */
export interface OpenApiParityViolation {
  /** The offending route ("METHOD path") or OpenAPI document entry. */
  entry: string;
  problem: string;
}

/** The generated OpenAPI contract, relative to the repo root (same path `apps/server/src/openapi/generate.ts` writes). */
const OPENAPI_DOC_PATH = 'docs/openapi.json';

/**
 * `:id(^[^:]+):complete` -> `{id}:complete` — mirrors
 * `apps/server/src/openapi/buildDocument.ts`'s `toOpenApiPath` exactly, so a
 * real route and its documented entry compare under the same key. Duplicated
 * rather than imported: `tools/repo-tools` has no dependency on
 * `apps/server`, and introducing one for a single regex would be a heavier
 * coupling than keeping the two in sync by hand.
 */
const PARAM_SEGMENT = /^:([A-Za-z0-9_]+)(?:\([^)]*\))?(:.*)?$/;

function toOpenApiPath(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      const match = PARAM_SEGMENT.exec(segment);
      if (!match) return segment;
      const [, name, suffix] = match;
      return `{${name}}${suffix ?? ''}`;
    })
    .join('/');
}

/** Every "METHOD path" key documented in a parsed OpenAPI document's `paths`. */
function documentedKeys(doc: unknown): Set<string> {
  const paths = (doc as { paths?: Record<string, Record<string, unknown>> } | null)?.paths;
  const keys = new Set<string>();
  if (!paths) return keys;

  for (const [path, methods] of Object.entries(paths)) {
    for (const method of Object.keys(methods ?? {})) {
      keys.add(`${method.toUpperCase()} ${path}`);
    }
  }
  return keys;
}

/**
 * Cross-references `docs/openapi.json` against the routes the server
 * actually registers (`extractServerRoutes`, API-02). Returns one violation
 * per real route missing an OpenAPI entry and one per OpenAPI entry with no
 * matching real route; an empty array means the two agree.
 *
 * A missing or route-less document is a violation on its own — same "proves
 * nothing, so it fails" rule `checkCapabilityMap` already applies to an empty
 * capability map (spec.md Edge Case: "IF a geração do OpenAPI produzir um
 * documento sem nenhuma rota THEN o CI SHALL falhar").
 */
export function checkOpenApiParity(sourceRoot: string): OpenApiParityViolation[] {
  const docPath = join(sourceRoot, ...OPENAPI_DOC_PATH.split('/'));

  if (!existsSync(docPath)) {
    return [
      { entry: OPENAPI_DOC_PATH, problem: `no OpenAPI document found at ${OPENAPI_DOC_PATH}` },
    ];
  }

  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(docPath, 'utf8'));
  } catch (error) {
    return [
      {
        entry: OPENAPI_DOC_PATH,
        problem: `could not parse ${OPENAPI_DOC_PATH}: ${(error as Error).message}`,
      },
    ];
  }

  const documented = documentedKeys(doc);
  if (documented.size === 0) {
    return [
      {
        entry: OPENAPI_DOC_PATH,
        problem: `${OPENAPI_DOC_PATH} declares no route, so it proves nothing`,
      },
    ];
  }

  const realRoutes = extractServerRoutes(sourceRoot);
  const realKeys = new Set(realRoutes.map((route) => `${route.method} ${toOpenApiPath(route.path)}`));

  const violations: OpenApiParityViolation[] = [];

  for (const route of realRoutes) {
    const key = `${route.method} ${toOpenApiPath(route.path)}`;
    if (!documented.has(key)) {
      violations.push({
        entry: `${route.method} ${route.path}`,
        problem: `registered in ${route.file} but has no entry in ${OPENAPI_DOC_PATH}`,
      });
    }
  }

  for (const key of documented) {
    if (!realKeys.has(key)) {
      violations.push({
        entry: key,
        problem: `documented in ${OPENAPI_DOC_PATH} but no matching route is registered`,
      });
    }
  }

  return violations;
}
