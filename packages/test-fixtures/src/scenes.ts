// Minimal, well-formed Excalidraw scene fixtures for unit tests across the monorepo.
//
// Fixtures are built in two steps, both going through the package's public API only
// (never a `@excalidraw/excalidraw/dist/...` deep import):
//   1. `convertToExcalidrawElements` turns a small hand-written "skeleton" (the same
//      shape the Excalidraw docs recommend for programmatic scene generation) into full
//      elements with every base field filled in.
//   2. `restoreElements` runs the result through the same repair/normalization pass the
//      real app runs when it loads a `.excalidraw` file or a paste, so a fixture is
//      exactly as well-formed as anything the running app would produce.
//
// Types are derived structurally from these two public functions (`Parameters<...>`,
// `ReturnType<...>`) instead of reaching into an internal type path like
// `@excalidraw/excalidraw/element/types` — see `packages/editor-adapter/src/types.ts`
// for the same convention, documented there in full.
import { convertToExcalidrawElements, restoreElements } from '@excalidraw/excalidraw';

type Skeleton = NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>;
export type SceneElement = ReturnType<typeof restoreElements>[number];

function buildScene(skeleton: Skeleton): SceneElement[] {
  const converted = convertToExcalidrawElements(skeleton);
  return restoreElements(converted, null);
}

/** A single text element, no container. */
export const textFixture: readonly SceneElement[] = buildScene([
  { type: 'text', x: 100, y: 100, text: 'Hello architecture canvas' },
]);

/** An arrow bound at both ends to two rectangles (startBinding + endBinding). */
export const arrowWithBindingsFixture: readonly SceneElement[] = buildScene([
  { type: 'rectangle', id: 'fixture-rect-a', x: 0, y: 0, width: 120, height: 80 },
  { type: 'rectangle', id: 'fixture-rect-b', x: 400, y: 0, width: 120, height: 80 },
  {
    type: 'arrow',
    x: 120,
    y: 40,
    start: { id: 'fixture-rect-a', type: 'rectangle' },
    end: { id: 'fixture-rect-b', type: 'rectangle' },
  },
]);

/**
 * A single image element. `fileId` only needs to be a stable reference — the binary
 * itself is out of scope for these structural fixtures. `convertToExcalidrawElements`
 * types `fileId` as the branded `FileId` string, which we satisfy with a narrow local
 * cast rather than importing the brand type from an internal path.
 */
const imageSkeletonElement = {
  type: 'image',
  x: 0,
  y: 0,
  width: 200,
  height: 150,
  fileId: 'fixture-image-file-id',
} as unknown as Skeleton[number];

export const imageFixture: readonly SceneElement[] = buildScene([imageSkeletonElement]);

/** A frame containing two child rectangles. */
export const frameFixture: readonly SceneElement[] = buildScene([
  { type: 'rectangle', id: 'fixture-frame-child-a', x: 10, y: 10, width: 60, height: 60 },
  { type: 'rectangle', id: 'fixture-frame-child-b', x: 90, y: 10, width: 60, height: 60 },
  {
    type: 'frame',
    name: 'Fixture frame',
    children: ['fixture-frame-child-a', 'fixture-frame-child-b'],
  },
]);

/** Two rectangles sharing a `groupIds` entry, i.e. a two-element group. */
export const groupFixture: readonly SceneElement[] = buildScene([
  { type: 'rectangle', x: 0, y: 200, width: 80, height: 80, groupIds: ['fixture-group-1'] },
  { type: 'rectangle', x: 100, y: 200, width: 80, height: 80, groupIds: ['fixture-group-1'] },
]);

export const allFixtures: Readonly<Record<string, readonly SceneElement[]>> = {
  text: textFixture,
  arrowWithBindings: arrowWithBindingsFixture,
  image: imageFixture,
  frame: frameFixture,
  group: groupFixture,
};
