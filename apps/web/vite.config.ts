import { SERVER_ROUTE_PREFIXES, WS_ROUTE_PREFIX } from '@arch-canvas/shared-contracts';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev proxy target: apps/server's default port (see apps/server/src/core/config.ts).
const API_PROXY_TARGET = 'http://localhost:3000';

// EDGE-06..08: the prefix list is imported, never restated here. It used to be a local
// literal that covered six prefixes and omitted seven — so the AI dock, the component
// library, the provider admin, presentations, share links and the member-invite lookup all
// received `index.html` instead of JSON in development, silently. The single source is
// `packages/shared-contracts/src/routePrefixes.ts`; `tools/repo-tools`' edge-parity test
// fails when this file and the Caddyfile drift from the registered routes.

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      ...Object.fromEntries(
        SERVER_ROUTE_PREFIXES.map((prefix) => [
          prefix,
          { target: API_PROXY_TARGET, changeOrigin: true },
        ]),
      ),
      // LIVE-06: a WebSocket upgrade, not a plain HTTP request — without `ws: true` the
      // editor's presence session simply never connects under `make web-dev`.
      [WS_ROUTE_PREFIX]: { target: API_PROXY_TARGET, changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: 'dist',
  },
});
