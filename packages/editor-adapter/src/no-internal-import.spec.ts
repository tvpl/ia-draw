import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(full);
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [full] : [];
  });
}

// Matches an actual `import ... from` / `require(...)` of ANY subpath under the
// package — e.g. `@excalidraw/excalidraw/dist/...` or
// `@excalidraw/excalidraw/element/types` — i.e. anything after the bare package
// specifier. Anchored to `from`/`require(` so mentioning the path in a comment (as the
// doc-comments in this package do, to cite where a type was verified) doesn't trip it.
// Per types.ts: the package's own `exports` map gives subpaths no runtime condition,
// so only the bare "." root resolves at runtime, and that's the only specifier this
// package is allowed to use.
const INTERNAL_IMPORT_PATTERN = /(?:from\s+|require\()['"]@excalidraw\/excalidraw\/[^"'`]+['"]/;

describe('no internal @excalidraw/excalidraw imports', () => {
  const files = collectSourceFiles(SRC_DIR).filter((file) => !file.endsWith('.spec.ts'));

  it('scanned at least one source file', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s only imports the package root', (file) => {
    const content = readFileSync(file, 'utf8');
    const match = content.match(INTERNAL_IMPORT_PATTERN);
    expect(match?.[0] ?? null).toBeNull();
  });
});
