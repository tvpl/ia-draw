import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    // This package is a fixtures library; T9 ships no dedicated spec file for it (the
    // fixtures are exercised by packages/editor-adapter's tests). Avoid failing the
    // workspace-wide `test:unit` run on an empty suite.
    passWithNoTests: true,
    // @excalidraw/excalidraw touches `window` at module top-level (constants.ts) even
    // for its non-UI exports (convertToExcalidrawElements, restoreElements, ...), so a
    // DOM shim is required just to import it in Node.
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // @excalidraw/excalidraw (and its roughjs dependency) ship ESM with extensionless
    // deep imports (e.g. `roughjs/bin/rough`) that only resolve through a bundler's
    // permissive resolver. Vitest externalizes node_modules by default and loads them
    // via Node's own strict ESM resolver, which rejects that import. Inlining routes
    // them through Vite's transform pipeline instead, where resolution succeeds.
    server: {
      deps: {
        inline: [/@excalidraw\/excalidraw/, /roughjs/],
      },
    },
  },
});
