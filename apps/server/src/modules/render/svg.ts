/**
 * `@excalidraw/utils@0.1.3-test32` ships `.d.ts` files whose re-exports reference
 * `@excalidraw/common` and `@excalidraw/element/*` as separate packages — neither is
 * listed in `@excalidraw/utils`'s own `package.json#dependencies`, nor present
 * anywhere in node_modules. TypeScript can't resolve `export.d.ts`'s re-exports as a
 * result, so `exportToSvg` type-checks as a missing export even though it exists and
 * works correctly at runtime (verified in `render.spec.ts`; confirmed with
 * `tsc --traceResolution`, which shows `@excalidraw/element/bounds` failing to
 * resolve). This is a real gap in the published package, not a local misconfiguration.
 *
 * We import the runtime value under `@ts-expect-error` and re-type it by hand from the
 * real signature read directly out of
 * node_modules/@excalidraw/utils/dist/types/utils/src/export.d.ts:
 *
 *   exportToSvg(opts: {
 *     elements: readonly NonDeleted<ExcalidrawElement>[];
 *     appState?: Partial<Omit<AppState, "offsetTop" | "offsetLeft">>;
 *     files: BinaryFiles | null;
 *     exportPadding?: number;
 *     renderEmbeddables?: boolean;
 *     exportingFrame?: ExcalidrawFrameLikeElement | null;
 *     skipInliningFonts?: true;
 *     reuseImages?: boolean;
 *   }): Promise<SVGSVGElement>
 *
 * It resolves an actual DOM `SVGSVGElement`, not a string — serializing it is the
 * caller's job (`.outerHTML` below). `files` is required, not optional; `null` is fine
 * when the scene's image elements have no binary content to embed (as in these
 * fixtures), which yields a broken-image placeholder rather than a thrown error.
 */
// @ts-expect-error -- see comment above: @excalidraw/utils's own .d.ts does not resolve
import { exportToSvg as exportToSvgUntyped } from '@excalidraw/utils';
import { ensureDomEnvironment } from './dom-environment.js';

/** A rendering-relevant Excalidraw element. Only field shapes exportToSvg reads matter. */
export type RenderElement = Record<string, unknown> & { id: string };
export type RenderElements = readonly RenderElement[];
export type RenderAppState = Record<string, unknown> | undefined;

type ExportToSvgFn = (opts: {
  elements: RenderElements;
  appState?: RenderAppState;
  files: null;
}) => Promise<{ outerHTML: string }>;

const exportToSvg = exportToSvgUntyped as ExportToSvgFn;

/** Renders a scene to an SVG string in Node, without a browser. */
export async function renderSceneToSvg(
  elements: RenderElements,
  appState?: RenderAppState,
): Promise<string> {
  ensureDomEnvironment();

  const svgElement = await exportToSvg({
    elements,
    appState,
    files: null,
  });

  return svgElement.outerHTML;
}
