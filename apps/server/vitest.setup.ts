// See src/modules/render/dom-environment.ts for the full rationale: @excalidraw/utils
// (transitively, via @excalidraw/excalidraw used by @arch-canvas/test-fixtures) touches
// the browser's CSS Font Loading API at module init, which jsdom does not implement.
// This is a headless-test shim only; it ships in no production code path other than
// dom-environment.ts's own equivalent shim for the real (non-Vitest) server process.
if (typeof globalThis.FontFace === 'undefined') {
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

  // biome-ignore lint/suspicious/noExplicitAny: shimming a browser global not in the Node lib
  (globalThis as any).FontFace = FontFaceShim;
}
