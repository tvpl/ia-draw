import { JSDOM } from 'jsdom';

let installed = false;

/**
 * `@excalidraw/utils`'s `exportToSvg` (and the browser-oriented code it pulls in —
 * roughjs, font metrics, ...) reads `window`/`document`/`FontFace` directly off the
 * global scope. There is no headless/Node entry point and no way to inject a DOM — this
 * was confirmed by reading `@excalidraw/utils`'s and `@excalidraw/excalidraw`'s
 * compiled output while building this spike (see also `packages/editor-adapter`'s
 * `types.ts`, which hit the same constraint from the editor-adapter side).
 *
 * This installs a jsdom-backed global environment once per process so `exportToSvg`
 * can run inside the plain-Node Fastify server, which has no DOM by default. Under
 * Vitest with `environment: 'jsdom'`, `window`/`document` already exist, so this is a
 * no-op for those two globals there — only the `FontFace` shim (which jsdom itself does
 * not implement) is added in both contexts.
 *
 * Global mutation is unavoidable here, not a shortcut: the library reads these as
 * ambient globals, not as constructor/function arguments.
 */
// This tsconfig has no DOM lib (the server is not a browser environment), so
// `document`/`FontFace` aren't declared members of `typeof globalThis`. They are read
// and written here purely as ambient globals a dependency expects to find, not as
// typed APIs this module itself uses — hence the loose `Record<string, unknown>` view.
const ambientGlobals = globalThis as unknown as Record<string, unknown>;

export function ensureDomEnvironment(): void {
  if (installed) {
    return;
  }

  if (typeof ambientGlobals.document === 'undefined') {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      pretendToBeVisual: true,
    });

    const domGlobals: Record<string, unknown> = {
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      HTMLElement: dom.window.HTMLElement,
      HTMLCanvasElement: dom.window.HTMLCanvasElement,
      SVGSVGElement: dom.window.SVGSVGElement,
      Image: dom.window.Image,
      // `@excalidraw/utils`'s font-face CSS generation reads this directly off
      // the global scope too (confirmed by reproducing a real plain-`node`
      // boot without it: `ReferenceError: devicePixelRatio is not defined`,
      // thrown from inside exportToSvg's font pipeline before this fix — see
      // T32's implementation notes). jsdom's own `window.devicePixelRatio`
      // (1 under `pretendToBeVisual`) is reused rather than hardcoding a value.
      devicePixelRatio: dom.window.devicePixelRatio ?? 1,
    };

    for (const [key, value] of Object.entries(domGlobals)) {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
  }

  if (typeof ambientGlobals.FontFace === 'undefined') {
    class FontFaceShim {
      family: string;
      source: string;
      status = 'unloaded';
      [key: string]: unknown;

      constructor(family: string, source: string, descriptors?: Record<string, unknown>) {
        this.family = family;
        this.source = source;
        Object.assign(this, descriptors);
      }

      load(): Promise<this> {
        this.status = 'loaded';
        return Promise.resolve(this);
      }
    }

    Object.defineProperty(globalThis, 'FontFace', {
      value: FontFaceShim,
      configurable: true,
      writable: true,
    });
  }

  installed = true;
}
