import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    // Coverage floor (CIQ-04): each number is the value measured when the floor
    // was introduced, locked as a ratchet. Lowering any of them requires editing
    // this file on purpose — no threshold is inherited implicitly.
    coverage: {
      enabled: true,
      provider: 'v8',
      thresholds: {
        lines: 97.61,
        functions: 50,
        branches: 75,
        statements: 97.61,
      },
    },
  },
});
