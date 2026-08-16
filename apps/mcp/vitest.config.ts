import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    // No DOM/Excalidraw dependency in this package — the default node
    // environment is enough (unlike packages that import editor-adapter).
    passWithNoTests: true,
    // Coverage floor (CIQ-04): locked as a ratchet at the value measured when
    // the floor was introduced (T10) — no threshold is inherited implicitly.
    coverage: {
      enabled: true,
      provider: 'v8',
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
