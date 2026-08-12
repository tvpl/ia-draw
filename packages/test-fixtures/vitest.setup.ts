// @excalidraw/excalidraw registers font metadata at module init time using the
// browser's CSS Font Loading API (`FontFace`), which jsdom does not implement. The
// actual font bytes are never touched by the pure functions this package uses
// (`convertToExcalidrawElements`, `restoreElements`) — only the constructor needs to
// exist and not throw. This is a headless-test shim only; it ships in no production code.
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
