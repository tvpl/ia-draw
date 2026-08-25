import { type Dirent, readdirSync, readFileSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

/** One HTTP endpoint the web app requests. */
export interface WebConsumer {
  /**
   * Request path with the query string stripped and every `${...}`
   * interpolation normalized to `:param`. Empty when `resolvable` is false.
   */
  path: string;
  /** The call's first argument exactly as written in the source. */
  expression: string;
  /** Source file, relative to the repo root, with POSIX separators. */
  file: string;
  /** False when the url is assembled at runtime and cannot be read statically. */
  resolvable: boolean;
}

/** Directory scanned for outgoing requests, relative to the repo root. */
const WEB_SRC_DIR = 'apps/web/src';

/**
 * Matches the two call forms the app uses: the global `fetch(` and the
 * injectable `this.fetchImpl(` that `syncClient` routes every request through.
 */
/**
 * DOCS-01 (F11/R23): widened from the two literal names `fetch`/`fetchImpl` to any identifier
 * whose *tail* is `fetch`/`Fetch`, optionally suffixed with `Impl` — which covers `fetch`,
 * `fetchImpl`, `doFetch`, `adminFetch`, `rawFetchImpl` and anything else a client binds its
 * injected fetch to.
 *
 * The narrow pattern was a real blind spot, not a stylistic preference: `lintClient.ts`
 * binds its injected fetch to `doFetch` and therefore vanished from the inventory
 * entirely, even though `LintPanel` calls the route on every mount. Several other clients
 * carry a comment explaining that they were written as `fetchImpl(` specifically so the
 * extractor would see them — a convention holding up a measurement is a measurement that
 * undercounts the moment someone renames a binding, which is precisely how the
 * documentation could only ever understate what shipped.
 *
 * The tail is what makes it a binding of the fetch API rather than a domain verb: matching
 * any identifier *containing* `fetch` also swallowed `DocsPanel`'s local
 * `fetchContentFor(item)`, which performs no request of its own, and reported its argument
 * as an unreadable endpoint.
 */
const FETCH_CALL_PATTERN = /(?:^|[^\w$.])(?:this\.)?[\w$]*(?:fetch|Fetch)(?:Impl)?\(/g;

function isProductionSource(fileName: string): boolean {
  const isSource = fileName.endsWith('.ts') || fileName.endsWith('.tsx');
  const isTest = fileName.endsWith('.spec.ts') || fileName.endsWith('.spec.tsx');
  return isSource && !isTest;
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
 * Blanks out `//` and block comments, keeping every other character at its
 * original index. Without this a prose mention of `this.fetchImpl(...)` in a
 * doc comment would be reported as a real endpoint.
 */
function stripComments(source: string): string {
  const out = source.split('');
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        out[index] = ' ';
        index += 1;
      }
    } else if (char === '/' && next === '*') {
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] !== '\n') out[index] = ' ';
        index += 1;
      }
      out[index] = ' ';
      out[index + 1] = ' ';
      index += 2;
    } else if (char === "'" || char === '"' || char === '`') {
      index += 1;
      while (index < source.length && source[index] !== char) {
        index += source[index] === '\\' ? 2 : 1;
      }
      index += 1;
    } else {
      index += 1;
    }
  }

  return out.join('');
}

/** Reads a quoted string starting at `start`, returning its raw source text. */
function readQuoted(source: string, start: number, quote: string): string {
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') index += 2;
    else if (char === quote) return source.slice(start, index + 1);
    else index += 1;
  }
  return source.slice(start);
}

/** Reads a template literal starting at `start`, tolerating nested `${...}`. */
function readTemplate(source: string, start: number): string {
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') {
      index += 2;
    } else if (char === '`') {
      return source.slice(start, index + 1);
    } else if (char === '$' && source[index + 1] === '{') {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source[index] === '{') depth += 1;
        else if (source[index] === '}') depth -= 1;
        index += 1;
      }
    } else {
      index += 1;
    }
  }
  return source.slice(start);
}

/** Reads an arbitrary first argument, stopping at the top-level `,` or `)`. */
function readArgument(source: string, start: number): string {
  let index = start;
  let depth = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' && depth === 0) break;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === ',' && depth === 0) break;
    index += 1;
  }
  return source.slice(start, index).trim();
}

/**
 * A `${...}` that sits directly after a literal colon is the parameter, colon included —
 * `/diagrams/${id}/export:${format}` is the client's way of writing Fastify's
 * `/diagrams/:id/export:format`. Consuming the colon keeps the two spellings comparable;
 * emitting `export::param` made a route that is very much consumed look orphaned.
 */
function toPath(expression: string): string {
  const literal = expression.slice(1, -1).replace(/:?\$\{[^}]*\}/g, ':param');
  return literal.split('?')[0] ?? '';
}

/**
 * Scans `apps/web/src` under `sourceRoot` and returns every endpoint the web
 * app requests, in file order. Frontend test files are skipped so their mocked
 * urls never count as production consumers. A url assembled from a variable is
 * reported with `resolvable: false` rather than silently dropped (UIX-01).
 */
export function extractWebConsumers(sourceRoot: string): WebConsumer[] {
  const webSrcDir = join(sourceRoot, ...WEB_SRC_DIR.split('/'));
  const consumers: WebConsumer[] = [];

  for (const absolute of listSourceFiles(webSrcDir)) {
    const file = absolute.slice(sourceRoot.length).split(sep).filter(Boolean).join(posix.sep);
    const code = stripComments(readFileSync(absolute, 'utf8'));

    for (const match of code.matchAll(FETCH_CALL_PATTERN)) {
      let argumentStart = (match.index ?? 0) + match[0].length;
      // The call's first argument may sit on the next line.
      while (argumentStart < code.length && /\s/.test(code[argumentStart] ?? ''))
        argumentStart += 1;
      const opener = code[argumentStart];

      if (opener === "'" || opener === '"') {
        const expression = readQuoted(code, argumentStart, opener);
        consumers.push({ path: toPath(expression), expression, file, resolvable: true });
      } else if (opener === '`') {
        const expression = readTemplate(code, argumentStart);
        consumers.push({ path: toPath(expression), expression, file, resolvable: true });
      } else {
        const expression = readArgument(code, argumentStart);
        consumers.push({ path: '', expression, file, resolvable: false });
      }
    }
  }

  return consumers;
}
