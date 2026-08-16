import { type Dirent, readdirSync, readFileSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

/** One REST route registered by a server module. */
export interface ServerRoute {
  /** Uppercase HTTP method, e.g. `GET`. */
  method: string;
  /** Path exactly as registered, e.g. `/diagrams/:id/bootstrap`. */
  path: string;
  /** Source file, relative to the repo root, with POSIX separators. */
  file: string;
}

/** Directory scanned for route registrations, relative to the repo root. */
const MODULES_DIR = 'apps/server/src/modules';

/**
 * `app.<method>('<path>'` — the single registration convention every server
 * module uses. Whitespace between `(` and the quote is tolerated so that
 * multi-line registrations are matched too.
 */
const ROUTE_PATTERN = /\bapp\.(get|post|put|patch|delete|head|options)\(\s*'([^']*)'/g;

function isProductionSource(fileName: string): boolean {
  return fileName.endsWith('.ts') && !fileName.endsWith('.spec.ts');
}

function listSourceFiles(directory: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(absolute));
    else if (isProductionSource(entry.name)) files.push(absolute);
  }
  return files;
}

/**
 * Scans `apps/server/src/modules` under `sourceRoot` and returns every REST
 * route the server registers, in file order. Test files (`*.spec.ts`, which
 * covers `*.int.spec.ts`) are skipped so fixture routes never reach the
 * inventory. A directory or file with no registration yields no entries
 * rather than an error (UIX-01).
 */
export function extractServerRoutes(sourceRoot: string): ServerRoute[] {
  const modulesDir = join(sourceRoot, ...MODULES_DIR.split('/'));
  const routes: ServerRoute[] = [];

  for (const absolute of listSourceFiles(modulesDir)) {
    const relative = absolute.slice(sourceRoot.length).split(sep).filter(Boolean).join(posix.sep);
    const contents = readFileSync(absolute, 'utf8');
    for (const match of contents.matchAll(ROUTE_PATTERN)) {
      routes.push({ method: match[1]?.toUpperCase() ?? '', path: match[2] ?? '', file: relative });
    }
  }

  return routes;
}
