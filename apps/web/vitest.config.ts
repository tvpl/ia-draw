import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // @arch-canvas/editor-adapter (transitively, @excalidraw/excalidraw) touches the
    // browser's CSS Font Loading API at module init — see
    // packages/editor-adapter/vitest.config.ts for the full rationale (same shim).
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
        lines: 56.54,
        functions: 72.5,
        branches: 85.52,
        statements: 56.54,
      },
    },
  },
});
