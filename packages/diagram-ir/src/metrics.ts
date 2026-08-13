import type {
  ArrowElement,
  CompiledElement,
  CompiledScene,
  RectangleElement,
  TextElement,
} from './compile.js';

/**
 * Deterministic geometric quality metrics for a compiled scene (T48),
 * proving the AIG-03 acceptance criterion ("zero overlapping nodes and
 * zero truncated labels for scenes up to 200 elements") without rendering
 * anything — every number here comes from the elements' own recorded
 * geometry.
 */
export interface GeometryMetrics {
  overlaps: number;
  crossings: number;
  truncatedLabels: number;
  whitespaceBalance: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function isRectangle(element: CompiledElement): element is RectangleElement {
  return element.type === 'rectangle';
}

function isArrow(element: CompiledElement): element is ArrowElement {
  return element.type === 'arrow';
}

function isText(element: CompiledElement): element is TextElement {
  return element.type === 'text';
}

function rectsOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function fullyContains(outer: Box, inner: Box): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  );
}

/**
 * `compile()` (T47) represents both `IrNode`s and `IrContainer`s as
 * `rectangle` elements, and a container's whole purpose is to visually
 * enclose its children — so a container's box legitimately, intentionally
 * overlaps (contains) every element nested inside it. That's not the
 * "overlapping nodes" defect this metric exists to catch.
 *
 * Since the compiled scene carries no explicit parent/child pointer
 * between rectangles (the IR's containment tree isn't preserved as a
 * scene-element field — see T47's `compile.ts` for why containers are
 * plain rectangles, not Excalidraw `frame` elements), this distinguishes
 * "legitimate nesting" from "genuine overlap" geometrically: a container
 * is always strictly larger in area than anything it was laid out to
 * enclose (every layout engine adds real padding, T44-T46), so a pair
 * where one box *fully* contains the other AND is strictly larger is
 * nesting, not a defect. All of this compiler's leaf nodes share the same
 * fixed size, so two genuinely-overlapping siblings can never satisfy
 * "strictly larger" by coincidence — this heuristic doesn't create false
 * negatives for same-sized elements landing on top of each other.
 */
function isLegitimateNesting(a: Box, b: Box): boolean {
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  if (fullyContains(a, b) && areaA > areaB) return true;
  if (fullyContains(b, a) && areaB > areaA) return true;
  return false;
}

function countOverlaps(rectangles: RectangleElement[]): number {
  let count = 0;
  for (let i = 0; i < rectangles.length; i++) {
    for (let j = i + 1; j < rectangles.length; j++) {
      // biome-ignore lint/style/noNonNullAssertion: i, j both in range by the loop bounds
      const a = rectangles[i]!;
      // biome-ignore lint/style/noNonNullAssertion: i, j both in range by the loop bounds
      const b = rectangles[j]!;
      if (isLegitimateNesting(a, b)) continue;
      if (rectsOverlap(a, b)) count++;
    }
  }
  return count;
}

interface Segment {
  edgeElementId: string;
  fromId: string | null;
  toId: string | null;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function arrowToSegment(arrow: ArrowElement): Segment {
  const last = arrow.points.at(-1) ?? [0, 0];
  return {
    edgeElementId: arrow.id,
    fromId: arrow.startBinding?.elementId ?? null,
    toId: arrow.endBinding?.elementId ?? null,
    x1: arrow.x,
    y1: arrow.y,
    x2: arrow.x + last[0],
    y2: arrow.y + last[1],
  };
}

function orientation(
  px: number,
  py: number,
  qx: number,
  qy: number,
  rx: number,
  ry: number,
): number {
  const value = (qy - py) * (rx - qx) - (qx - px) * (ry - qy);
  if (value === 0) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(
  px: number,
  py: number,
  qx: number,
  qy: number,
  rx: number,
  ry: number,
): boolean {
  return (
    Math.min(px, rx) <= qx &&
    qx <= Math.max(px, rx) &&
    Math.min(py, ry) <= qy &&
    qy <= Math.max(py, ry)
  );
}

/** Standard orientation-based proper segment intersection test (handles the collinear/touching edge cases). */
function segmentsIntersect(a: Segment, b: Segment): boolean {
  const o1 = orientation(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const o2 = orientation(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  const o3 = orientation(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const o4 = orientation(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);

  if (o1 !== o2 && o3 !== o4) return true;

  if (o1 === 0 && onSegment(a.x1, a.y1, b.x1, b.y1, a.x2, a.y2)) return true;
  if (o2 === 0 && onSegment(a.x1, a.y1, b.x2, b.y2, a.x2, a.y2)) return true;
  if (o3 === 0 && onSegment(b.x1, b.y1, a.x1, a.y1, b.x2, b.y2)) return true;
  if (o4 === 0 && onSegment(b.x1, b.y1, a.x2, a.y2, b.x2, b.y2)) return true;

  return false;
}

/**
 * Two edges that share an endpoint node (a common `from`/`to`) always meet
 * exactly at that node's center — that's an expected junction, not a
 * "crossing" in the diagram-quality sense this metric targets.
 */
function shareEndpoint(a: Segment, b: Segment): boolean {
  return (
    (a.fromId !== null && (a.fromId === b.fromId || a.fromId === b.toId)) ||
    (a.toId !== null && (a.toId === b.fromId || a.toId === b.toId))
  );
}

function countCrossings(arrows: ArrowElement[]): number {
  const segments = arrows.map(arrowToSegment);
  let count = 0;
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      // biome-ignore lint/style/noNonNullAssertion: i, j both in range by the loop bounds
      const a = segments[i]!;
      // biome-ignore lint/style/noNonNullAssertion: i, j both in range by the loop bounds
      const b = segments[j]!;
      if (shareEndpoint(a, b)) continue;
      if (segmentsIntersect(a, b)) count++;
    }
  }
  return count;
}

/**
 * Average character width as a fraction of `fontSize`, keyed by
 * `fontFamily` (Excalidraw's numeric font family id — this compiler only
 * ever emits `fontFamily: 5`, `packages/test-fixtures/src/generateScene.ts`'s
 * own convention). This is a deliberately coarse, documented heuristic —
 * ~0.5em per character is a commonly-cited average for proportional sans
 * fonts — not a real per-glyph measurement (the task explicitly allows
 * this: "não precisa medir a fonte real pixel-a-pixel"). It will
 * over-estimate width for narrow strings (all "i"/"l") and under-estimate
 * for wide ones (all "W"/"M"); it is not a substitute for real text
 * measurement, only a deterministic, canvas-free proxy for it.
 */
const AVERAGE_CHAR_WIDTH_EM: Record<number, number> = { 5: 0.5 };
const DEFAULT_AVERAGE_CHAR_WIDTH_EM = 0.5;
const LABEL_HORIZONTAL_PADDING = 16;

function estimateTextWidth(text: TextElement): number {
  const emWidth = AVERAGE_CHAR_WIDTH_EM[text.fontFamily] ?? DEFAULT_AVERAGE_CHAR_WIDTH_EM;
  return text.text.length * text.fontSize * emWidth + LABEL_HORIZONTAL_PADDING;
}

function countTruncatedLabels(texts: TextElement[]): number {
  return texts.filter((text) => estimateTextWidth(text) > text.width).length;
}

/**
 * Coefficient of variation (stddev / mean) of each rectangle's
 * nearest-neighbor center distance — 0 for a perfectly evenly-spaced
 * layout, growing as spacing becomes uneven/clustered. Formula chosen
 * for T48 ("desvio padrão normalizado da distância entre centros de
 * elementos vizinhos" — the task's own suggested example). Returns 0 for
 * 0 or 1 rectangles (no neighbor distance is defined).
 */
function computeWhitespaceBalance(rectangles: RectangleElement[]): number {
  if (rectangles.length < 2) return 0;

  const centers = rectangles.map((rect) => ({
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  }));
  const nearestDistances = centers.map((center, index) => {
    let min = Number.POSITIVE_INFINITY;
    centers.forEach((other, otherIndex) => {
      if (index === otherIndex) return;
      const dx = center.x - other.x;
      const dy = center.y - other.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < min) min = distance;
    });
    return min;
  });

  const mean = nearestDistances.reduce((sum, d) => sum + d, 0) / nearestDistances.length;
  if (mean === 0) return 0;

  const variance =
    nearestDistances.reduce((sum, d) => sum + (d - mean) ** 2, 0) / nearestDistances.length;
  const stddev = Math.sqrt(variance);
  return stddev / mean;
}

/** Computes all four T48 geometry metrics for a compiled scene. Pure and deterministic — no rendering, no I/O. */
export function geometryMetrics(scene: CompiledScene): GeometryMetrics {
  const rectangles = scene.elements.filter(isRectangle);
  const arrows = scene.elements.filter(isArrow);
  const texts = scene.elements.filter(isText);

  return {
    overlaps: countOverlaps(rectangles),
    crossings: countCrossings(arrows),
    truncatedLabels: countTruncatedLabels(texts),
    whitespaceBalance: computeWhitespaceBalance(rectangles),
  };
}
