import type { PersistableAppState, SceneElement } from '@arch-canvas/editor-adapter';
import { rasterizeSvgToPng, renderSceneToSvg } from '../render/index.js';
import { svgToPdfBuffer } from './pdf.js';
import { serializeScene } from './sceneFile.js';

/**
 * Default `appState` for server-side export: the diagram schema (`diagrams`/
 * `diagram_operations`, F1b) has no persisted `appState` field, only elements — so
 * exports use editor-adapter's own documented defaults for the persisted-document
 * subset of `AppState` (`sanitizeAppState`'s fallback values), applied locally per the
 * same runtime-import constraint documented in `sceneFile.ts`.
 */
export const DEFAULT_EXPORT_APP_STATE: PersistableAppState = {
  viewBackgroundColor: '#ffffff',
  gridSize: 0,
  gridStep: 5,
  gridModeEnabled: false,
  zenModeEnabled: false,
  theme: 'light',
  name: null,
};

export interface ExportedFormats {
  excalidraw: Buffer;
  svg: Buffer;
  png: Buffer;
  pdf: Buffer;
}

/**
 * Generates all 4 export formats (EXP-01) for a scene: `.excalidraw` (JSON, via
 * `sceneFile.serializeScene`), SVG and PNG (promoted from the T10 render spike,
 * `apps/server/src/modules/render`), and PDF (SVG->PDF, `pdf.ts`).
 */
export async function generateExports(
  elements: readonly SceneElement[],
  appState: PersistableAppState = DEFAULT_EXPORT_APP_STATE,
): Promise<ExportedFormats> {
  const excalidrawJson = serializeScene(elements, appState);
  // renderSceneToSvg's appState is an untyped Record passthrough to exportToSvg
  // (see render/svg.ts) — PersistableAppState has no index signature, so a structural
  // cast is needed even though every field it declares is a plain string/boolean/null.
  const svg = await renderSceneToSvg(elements, appState as unknown as Record<string, unknown>);
  const png = rasterizeSvgToPng(svg);
  const pdf = await svgToPdfBuffer(svg);

  return {
    excalidraw: Buffer.from(excalidrawJson, 'utf8'),
    svg: Buffer.from(svg, 'utf8'),
    png,
    pdf,
  };
}
