import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev proxy target: apps/server's default port (see apps/server/src/core/config.ts).
const API_PROXY_TARGET = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
