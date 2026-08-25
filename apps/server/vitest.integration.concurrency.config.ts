import { defineConfig } from 'vitest/config';

/**
 * CCP-08/09 (docs/adr/0007-*.md's second Emenda): the concurrency proof (RBAC-12, BOOT-08)
 * needs genuinely concurrent connections against a REAL Postgres, which PGlite — a single
 * embedded connection — cannot provide. Its own config, own `*.concurrency.int.spec.ts` glob,
 * own `make test-integration-concurrency` target, so it never rides along in `test:integration`
 * (which stays PGlite-only, no Postgres install required) — same named-exception pattern
 * `infra/backup`'s `test:integration:backup` already established.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.concurrency.int.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
