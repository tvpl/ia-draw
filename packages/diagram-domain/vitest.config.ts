import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    // See packages/test-fixtures/vitest.config.ts for why both settings below are
    // required just to import @excalidraw/excalidraw's pure functions (transitively,
    // via @arch-canvas/editor-adapter's applyRemote) in Node.
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    server: {
      deps: {
        inline: [/@excalidraw\/excalidraw/, /roughjs/],
      },
    },
  },
});
