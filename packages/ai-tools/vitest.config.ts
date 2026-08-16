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
    // Coverage floor (CIQ-04): each number is the value measured when the floor
    // was introduced, locked as a ratchet. Lowering any of them requires editing
    // this file on purpose — no threshold is inherited implicitly.
    coverage: {
      enabled: true,
      provider: 'v8',
      thresholds: {
        lines: 91.13,
        functions: 90.24,
        branches: 77.43,
        statements: 91.13,
      },
    },
  },
});
