import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', 'src/**/*.int.spec.ts'],
    // The render module's own fixtures (@arch-canvas/test-fixtures) transitively import
    // @excalidraw/excalidraw, which touches `window`/`FontFace` at module init. See
    // packages/editor-adapter/vitest.config.ts for the full rationale (same package,
    // same constraint). `ensureDomEnvironment()` still runs for real in the actual
    // server process, where no jsdom environment is pre-installed by a test runner.
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    server: {
      deps: {
        inline: [/@excalidraw\/excalidraw/, /@excalidraw\/utils/, /roughjs/],
      },
    },
    // Coverage floor (CIQ-04): each number is the value measured when the floor
    // was introduced, locked as a ratchet. Lowering any of them requires editing
    // this file on purpose — no threshold is inherited implicitly.
    //
    // `functions` lowered 39.73 -> 28.87 during F8 (platform-maturity), on
    // purpose, with justification: adding routeSchemas exports (+ their
    // RouteSchemaMap type import) across ~20 route files changed how V8's
    // coverage instrumentation attributes functions within those files —
    // handler closures that already existed, and were already untested, are
    // now counted individually instead of collapsed into the file's other
    // instrumentation, raising the true denominator from 302 to 426 with no
    // matching rise in covered functions. lines/branches/statements all
    // measured HIGHER on this same diff (this wave's own new code, the
    // OpenAPI builder + audit parity checker, is well-tested) — only
    // `functions` regressed, and only because it's now measuring more
    // accurately, not because anything got less tested. See the F8 Wave
    // Report in .specs/features/platform-maturity/validation.md (Fix Plan 1)
    // and lesson L-024 for the full trace.
    coverage: {
      enabled: true,
      provider: 'v8',
      thresholds: {
        lines: 25.48,
        functions: 28.87,
        branches: 80.27,
        statements: 25.48,
      },
    },
  },
});
