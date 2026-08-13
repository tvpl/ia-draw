/**
 * Benchmark: computeDiff / serializeScene / parseScene wall-clock time and payload
 * byte size, at 1k and 5k generated elements (T11).
 *
 * Run via `pnpm --filter @arch-canvas/editor-adapter benchmark` (`vitest bench`, not
 * `vitest run` — this file is named `*.bench.ts` on purpose, so it's picked up by
 * Vitest's benchmark runner and stays out of the regular `test:unit` gate, which only
 * globs `*.spec.ts`).
 *
 * A standalone `tsx` script was tried first and rejected: running outside Vitest's
 * Vite-backed module loader, plain Node's ESM loader fails to statically detect the
 * named export `@excalidraw/laser-pointer` (a transitive dependency of
 * `@excalidraw/excalidraw`) provides from its Parcel-built CJS bundle — a real
 * upstream ESM/CJS interop gap, not something fixable from this repo. Vitest's loader
 * (used by every other test in this monorepo that touches `@excalidraw/excalidraw`)
 * does not hit this, so the benchmark runs as a Vitest bench file instead.
 *
 * Lives in packages/editor-adapter, not packages/test-fixtures, because it exercises
 * editor-adapter's own functions against test-fixtures' generator — putting it in
 * test-fixtures would make that package depend on editor-adapter, which already
 * depends on test-fixtures (devDependency, for its own tests), creating a circular
 * workspace dependency that would deadlock Turborepo's `^build` task graph.
 * generateScene() and its own tests stay in packages/test-fixtures, matching the task.
 *
 * Numbers printed by this file were copied into docs/operations/benchmarks.md as the
 * recorded baseline; re-run and update that file if the adapter's implementation
 * changes materially.
 */
import { generateScene } from '@arch-canvas/test-fixtures';
import { restoreElements } from '@excalidraw/excalidraw';
import { bench, describe } from 'vitest';
import {
  buildSceneIndex,
  computeDiff,
  parseScene,
  sanitizeAppState,
  serializeScene,
} from './index.js';

type RestoreInput = Parameters<typeof restoreElements>[0];

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

for (const elementCount of [1000, 5000]) {
  const raw = generateScene(elementCount, 42);
  const elements = restoreElements(raw as unknown as RestoreInput, null);
  const appState = sanitizeAppState({});
  const json = serializeScene(elements, appState);
  const payloadBytes = Buffer.byteLength(json, 'utf8');
  const prevIndex = buildSceneIndex(elements);
  const emptyIndex = buildSceneIndex([]);

  // Payload size isn't a wall-clock metric `bench()` reports, so it's logged directly.
  // eslint-disable-next-line no-console
  console.log(
    `\n[benchmark] ${elementCount} elements: serialized payload = ${formatBytes(payloadBytes)}`,
  );

  describe(`${elementCount} elements`, () => {
    bench('serializeScene', () => {
      serializeScene(elements, appState);
    });

    bench('parseScene', () => {
      parseScene(json);
    });

    bench('computeDiff (all-upsert, empty prev)', () => {
      computeDiff(emptyIndex, elements);
    });

    bench('computeDiff (no-op, unchanged prev)', () => {
      computeDiff(prevIndex, elements);
    });
  });
}
