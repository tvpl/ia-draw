import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)));
const APP = join(SRC_ROOT, 'App.tsx');

/**
 * UIF-18/20: the canvas engine (plus mermaid, cytoscape and katex, which it drags along)
 * must not sit in the entry chunk — someone opening only the sign-in screen used to
 * download all of it.
 *
 * Asserted against the source rather than against `dist/`: the invariant that produces the
 * split is "every route module reaching @arch-canvas/editor-adapter is imported lazily",
 * and checking it here needs no build step and cannot be skipped when one is missing.
 */
function modulesReachingTheCanvas(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...modulesReachingTheCanvas(absolute));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.spec\.tsx?$/.test(entry)) continue;
    const source = readFileSync(absolute, 'utf8');
    if (!/from '@arch-canvas\/editor-adapter'/.test(source)) continue;
    // `import type` is erased at build time and pulls nothing into any chunk.
    if (/import type \{[^}]*\} from '@arch-canvas\/editor-adapter'/.test(source)) continue;
    found.push(relative(SRC_ROOT, absolute));
  }
  return found;
}

describe('bundle split (UIF-18, UIF-20)', () => {
  const app = readFileSync(APP, 'utf8');

  it('imports no route component that reaches the canvas statically', () => {
    const staticImports = [...app.matchAll(/^import \{ (\w+) \} from '(\.\/[^']+)';$/gm)].map(
      (match) => match[2] ?? '',
    );

    const canvasModules = modulesReachingTheCanvas(SRC_ROOT);
    const leaked = staticImports.filter((specifier) =>
      canvasModules.some((module) => specifier.includes(module.replace(/\.tsx?$/, ''))),
    );

    expect(leaked).toEqual([]);
  });

  it('loads the editor route through lazy(), behind a Suspense boundary', () => {
    expect(app).toMatch(/const DiagramEditorPage = lazy\(/);
    expect(app).toContain('<Suspense fallback={<RouteFallback />}>');
  });

  it('lazy-loads every route that reaches the canvas, not only the editor', () => {
    for (const route of [
      'DiagramEditorPage',
      'InventoryPage',
      'PresentationEditorPage',
      'PresenterModePage',
      'SharedResourcePage',
    ]) {
      expect(app).toMatch(new RegExp(`const ${route} = lazy\\(`));
    }
  });
});
