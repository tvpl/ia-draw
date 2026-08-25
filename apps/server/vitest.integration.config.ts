import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.int.spec.ts'],
    // CCP-08 (docs/adr/0007-*.md's second Emenda): `*.concurrency.int.spec.ts` files need a
    // real Postgres for genuine concurrent connections (PGlite is one embedded connection) —
    // they run only via `make test-integration-concurrency` / vitest.integration.concurrency
    // .config.ts, never here, so this command stays runnable with zero Postgres installed.
    exclude: ['src/**/*.concurrency.int.spec.ts'],
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
