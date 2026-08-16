import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    // The audit tooling only reads files from disk — no DOM, so the default
    // node environment is enough (unlike the packages that import Excalidraw).
    passWithNoTests: true,
  },
});
