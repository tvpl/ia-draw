import { coverageConfigDefaults, defineConfig } from 'vitest/config';

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
      // T13: `cli.ts` is the stdio entrypoint — tasks.md's own Test Coverage
      // Matrix marks it "none, build gate only... verified manually by
      // running it, not unit-tested" (stdio isn't something a unit test
      // exercises cheaply). Excluded here so the 100% ratchet keeps meaning
      // "every unit-tested line is covered", not "every line is importable
      // from a test file".
      exclude: [...coverageConfigDefaults.exclude, 'src/cli.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
