import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev proxy target: apps/server's default port (see apps/server/src/core/config.ts).
const API_PROXY_TARGET = 'http://localhost:3000';

// SPEC_DEVIATION: proxying `/api` matched nothing — every apps/server route (auth,
// workspace, diagram-sync) is registered unprefixed (`/auth/...`, `/workspaces/...`,
// `/diagrams/...`, etc.), never under `/api`. Fixed here (found while wiring T25's
// sync client, the dev proxy's first real caller) by proxying the actual route
// prefixes instead of a namespace no route ever used.
const API_ROUTE_PREFIXES = ['/health', '/auth', '/me', '/workspaces', '/projects', '/diagrams'];

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(
      API_ROUTE_PREFIXES.map((prefix) => [
        prefix,
        { target: API_PROXY_TARGET, changeOrigin: true },
      ]),
    ),
  },
  build: {
    outDir: 'dist',
  },
});
