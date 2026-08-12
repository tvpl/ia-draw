import { JSDOM } from 'jsdom';

/**
 * `@excalidraw/excalidraw` (pulled in transitively by diagram-sync ->
 * diagram-domain -> editor-adapter, for server-side LWW reconciliation) reads
 * `window`/`document`/many other browser globals — including bare references like
 * `devicePixelRatio` — directly off the global scope at module-eval time, with no
 * headless/Node entry point (same constraint documented in
 * apps/server/src/modules/render/dom-environment.ts and packages/editor-adapter's
 * types.ts). Vitest papers over this with `environment: 'jsdom'`; this script has no
 * test runner, so it installs the same jsdom-backed globals itself — copying jsdom's
 * `window`'s own properties onto `globalThis` broadly (not just a curated handful),
 * since which globals get referenced bare is an implementation detail of the vendored
 * bundle, not something worth chasing one ReferenceError at a time.
 */
export function installDomShim(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });

  const win = dom.window as unknown as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(win)) {
    if (key in globalThis) continue;
    try {
      Object.defineProperty(globalThis, key, {
        value: win[key],
        configurable: true,
        writable: true,
      });
    } catch {
      // A handful of jsdom window properties are non-configurable getters that throw
      // on redefinition — harmless to skip, nothing in the excalidraw chain needs them.
    }
  }
  Object.defineProperty(globalThis, 'window', {
    value: dom.window,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'document', {
    value: dom.window.document,
    configurable: true,
    writable: true,
  });

  // jsdom itself doesn't implement the CSS Font Loading API.
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
