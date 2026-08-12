import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    // Tests reuse @arch-canvas/test-fixtures, which transitively imports
    // @excalidraw/excalidraw (touches `window`/`FontFace` at module init). See
    // packages/diagram-domain/vitest.config.ts for the same constraint, same fix.
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    server: {
      deps: {
        inline: [/@excalidraw\/excalidraw/, /roughjs/],
      },
    },
  },
});
