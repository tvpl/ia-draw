import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', 'src/**/*.int.spec.ts'],
    // The render module's own fixtures (@arch-canvas/test-fixtures) transitively import
    // @excalidraw/excalidraw, which touches `window`/`FontFace` at module init. See
    // packages/editor-adapter/vitest.config.ts for the full rationale (same package,
    // same constraint). `ensureDomEnvironment()` still runs for real in the actual
    // server process, where no jsdom environment is pre-installed by a test runner.
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    server: {
      deps: {
        inline: [/@excalidraw\/excalidraw/, /@excalidraw\/utils/, /roughjs/],
      },
    },
    // Coverage floor (CIQ-04): each number is the value measured when the floor
    // was introduced, locked as a ratchet. Lowering any of them requires editing
    // this file on purpose — no threshold is inherited implicitly.
    coverage: {
      enabled: true,
      provider: 'v8',
      thresholds: {
        lines: 25.48,
        functions: 39.73,
        branches: 80.27,
        statements: 25.48,
      },
    },
  },
});
