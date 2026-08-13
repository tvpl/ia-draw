import { defineConfig } from 'vite';

/**
 * Config for `vite-node` (not for Vite's own dev/build) — used only to run
 * runTestServer.ts under Node with Vite's transform pipeline instead of Node's own
 * strict ESM resolver. `ssr.noExternal` is the non-Vitest equivalent of the
 * `server.deps.inline` setting every other vitest.config.ts in this repo already
 * needs for the same packages: @excalidraw/excalidraw's compiled bundle contains
 * extensionless deep imports (e.g. `roughjs/bin/rough`) that Node's resolver rejects
 * but Vite's own resolver accepts.
 */
export default defineConfig({
  ssr: {
    noExternal: [/@excalidraw\/excalidraw/, /@excalidraw\/utils/, /roughjs/],
  },
});
