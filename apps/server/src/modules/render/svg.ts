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
 *
 * The import below is a top-level *dynamic* import (`await import(...)` at module
 * scope), not a static one. Static ES module imports are evaluated eagerly, in source
 * order, before any other code in the importing file runs — so a static
 * `import ... from '@excalidraw/utils'` would execute that package's module body
 * (which reads `window`/`devicePixelRatio` off the global scope at evaluation time)
 * BEFORE `ensureDomEnvironment()` below ever got a chance to install them, no matter
 * where in the file the static import appeared. Confirmed by reproducing a real plain
 * `node` boot: a static import crashes with `ReferenceError: window is not defined`.
 * This was previously masked because Vitest's `environment: 'jsdom'` (this module's
 * own test config) pre-installs `window` globally before any test file loads, so the
 * bug never surfaced under `pnpm -w test:unit` — only a real `node dist/index.js` boot
 * exposes it (T32's mandated real-server-boot check).
 *
 * Making the import dynamic AND keeping it at module top level (not inside
 * `renderSceneToSvg`) gets both properties at once: `ensureDomEnvironment()` runs
 * first (dynamic imports evaluate at the point of the `import()` call, not hoisted),
 * and the one-time cost of loading `@excalidraw/utils` is still paid once, at module
 * load, instead of on every module's first call — an earlier version of this fix
 * moved the dynamic import inside the function body, which paid that same one-time
 * cost inside the first real request's/test's timeout window instead of at startup,
 * and timed out `render.spec.ts`'s first test as a result.
 */
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

ensureDomEnvironment();

// @ts-expect-error -- see comment above: @excalidraw/utils's own .d.ts does not resolve
const { exportToSvg: exportToSvgUntyped } = await import('@excalidraw/utils');
const exportToSvg = exportToSvgUntyped as ExportToSvgFn;

/** Renders a scene to an SVG string in Node, without a browser. */
export async function renderSceneToSvg(
  elements: RenderElements,
  appState?: RenderAppState,
): Promise<string> {
  const svgElement = await exportToSvg({
    elements,
    appState,
    files: null,
  });

  return svgElement.outerHTML;
}
