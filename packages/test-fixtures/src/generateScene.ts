/**
 * Deterministic synthetic scene generator, for benchmarking `computeDiff` /
 * `serializeScene` / `parseScene` at scale (T11) without depending on hand-authored
 * fixtures.
 *
 * The returned elements are NOT run through `@excalidraw/excalidraw`'s
 * `convertToExcalidrawElements` / `restoreElements` (unlike `scenes.ts`'s fixtures):
 * those helpers generate some fields (`updated` — via `Date.now()` — among others)
 * internally using their own unseeded randomness/wall clock, which would break the
 * "same seed → byte-identical output" requirement this generator exists for. Every
 * field here is instead derived directly from the seeded PRNG below (or a fixed
 * constant), so two calls with the same seed are provably identical. Callers that need
 * fully "real" elements (e.g. to feed `reconcileElements`) should run the result
 * through `restoreElements` themselves — see `generateScene.spec.ts` and
 * `docs/operations/benchmarks.md` for that pattern.
 */

/** A raw, not-yet-restored element. Structurally close to `ExcalidrawElement`, loosely typed. */
export type GeneratedElement = Record<string, unknown> & { id: string; type: string };

/**
 * mulberry32 — a tiny, public-domain, deterministic PRNG. Deliberately not
 * `Math.random()`: the same seed must always produce the same sequence.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STROKE_COLORS = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00'] as const;
const BACKGROUND_COLORS = ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99'] as const;
const FIXED_UPDATED_AT = 1_700_000_000_000; // fixed epoch ms — never Date.now()

function pick<T>(rng: () => number, values: readonly T[]): T {
  const index = Math.floor(rng() * values.length) % values.length;
  // biome-ignore lint/style/noNonNullAssertion: index is always in range by construction
  return values[index]!;
}

function baseFields(rng: () => number, id: string): Record<string, unknown> {
  return {
    id,
    x: Math.floor(rng() * 4000),
    y: Math.floor(rng() * 4000),
    strokeColor: pick(rng, STROKE_COLORS),
    backgroundColor: pick(rng, BACKGROUND_COLORS),
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roundness: null,
    roughness: 1,
    opacity: 100,
    angle: 0,
    seed: Math.floor(rng() * 2 ** 31),
    version: 1,
    versionNonce: Math.floor(rng() * 2 ** 31),
    index: null, // let restoreElements assign real fractional indices when restored
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: FIXED_UPDATED_AT,
    link: null,
    locked: false,
  };
}

function generateRectangle(rng: () => number, id: string): GeneratedElement {
  return {
    ...baseFields(rng, id),
    type: 'rectangle',
    width: 80 + Math.floor(rng() * 120),
    height: 60 + Math.floor(rng() * 80),
  } as unknown as GeneratedElement;
}

function generateText(rng: () => number, id: string, index: number): GeneratedElement {
  const text = `Node ${index}`;
  return {
    ...baseFields(rng, id),
    type: 'text',
    width: 20 + text.length * 8,
    height: 25,
    fontSize: 20,
    fontFamily: 5,
    text,
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    originalText: text,
    autoResize: true,
    lineHeight: 1.25,
  } as unknown as GeneratedElement;
}

function generateArrow(rng: () => number, id: string): GeneratedElement {
  const length = 60 + Math.floor(rng() * 200);
  return {
    ...baseFields(rng, id),
    type: 'arrow',
    width: length,
    height: 0,
    points: [
      [0, 0],
      [length, 0],
    ],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: 'arrow',
    elbowed: false,
  } as unknown as GeneratedElement;
}

/**
 * Generates `elementCount` elements deterministically from `seed`: a roughly even
 * split of rectangles, text and arrows (round-robin by index, so the split is exact,
 * not just "roughly" even by chance of the RNG).
 */
export function generateScene(elementCount: number, seed: number): GeneratedElement[] {
  const rng = mulberry32(seed);
  const elements: GeneratedElement[] = [];

  for (let i = 0; i < elementCount; i++) {
    const id = `gen-${seed}-${i}`;
    const kind = i % 3;
    if (kind === 0) {
      elements.push(generateRectangle(rng, id));
    } else if (kind === 1) {
      elements.push(generateText(rng, id, i));
    } else {
      elements.push(generateArrow(rng, id));
    }
  }

  return elements;
}
