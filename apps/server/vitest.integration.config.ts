import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.int.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // diagram-sync's integration tests (T21+) import @arch-canvas/diagram-domain, which
    // imports @arch-canvas/editor-adapter, which imports @excalidraw/excalidraw — same
    // FontFace/window constraint as vitest.config.ts (unit) above; see that file's
    // comment for the full rationale.
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    server: {
      deps: {
        inline: [/@excalidraw\/excalidraw/, /@excalidraw\/utils/, /roughjs/],
      },
    },
  },
});
