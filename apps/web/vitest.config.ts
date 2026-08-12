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
  },
});
