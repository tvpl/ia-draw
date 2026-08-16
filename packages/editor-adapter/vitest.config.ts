import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    // See packages/test-fixtures/vitest.config.ts for why both settings below are
    // required just to import @excalidraw/excalidraw's pure (non-UI) functions in Node.
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
        lines: 80.34,
        functions: 77.77,
        branches: 92.59,
        statements: 80.34,
      },
    },
  },
});
