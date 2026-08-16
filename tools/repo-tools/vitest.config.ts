import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    // The audit tooling only reads files from disk — no DOM, so the default
    // node environment is enough (unlike the packages that import Excalidraw).
    passWithNoTests: true,
    // Coverage floor (CIQ-04): each number is the value measured when the floor
    // was introduced, locked as a ratchet. Lowering any of them requires editing
    // this file on purpose — no threshold is inherited implicitly.
    coverage: {
      enabled: true,
      provider: 'v8',
      thresholds: {
        lines: 92.2,
        functions: 100,
        branches: 83.33,
        statements: 92.2,
      },
    },
  },
});
