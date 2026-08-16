import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkCoverageFloors } from './coverageFloors.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const WORKSPACE = `packages:
  - "apps/*"
  - "packages/*"
  - "infra/backup"
`;

const WITH_FLOOR = `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      enabled: true,
      provider: 'v8',
      thresholds: {
        lines: 91.2,
        statements: 91.2,
      },
    },
  },
});
`;

const WITHOUT_FLOOR = `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
  },
});
`;

let scratch: string | undefined;

/** Builds a throwaway monorepo root containing the given `path -> contents` files. */
function fakeRepo(files: Record<string, string>): string {
  scratch = mkdtempSync(join(tmpdir(), 'repo-tools-coverage-'));
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = join(scratch, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, 'utf8');
  }
  return scratch;
}

function pkg(name: string, scripts: Record<string, string>): string {
  return JSON.stringify({ name, private: true, scripts });
}

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

describe('checkCoverageFloors (CIQ-04)', () => {
  it('fails naming the package when test:unit exists with no coverage.thresholds', () => {
    const root = fakeRepo({
      'pnpm-workspace.yaml': WORKSPACE,
      'packages/newcomer/package.json': pkg('@arch-canvas/newcomer', { 'test:unit': 'vitest run' }),
      'packages/newcomer/vitest.config.ts': WITHOUT_FLOOR,
    });

    const violations = checkCoverageFloors(root);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.package).toBe('packages/newcomer');
    expect(violations[0]?.problem).toContain('coverage.thresholds');
  });

  it('fails when a package with test:unit has no vitest config to declare a floor in', () => {
    const root = fakeRepo({
      'pnpm-workspace.yaml': WORKSPACE,
      'apps/newcomer/package.json': pkg('@arch-canvas/newcomer', { 'test:unit': 'vitest run' }),
    });

    const violations = checkCoverageFloors(root);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.package).toBe('apps/newcomer');
    expect(violations[0]?.problem).toContain('vitest.config.ts');
  });

  it('fails on a thresholds block that declares no number, instead of accepting the shell', () => {
    const root = fakeRepo({
      'pnpm-workspace.yaml': WORKSPACE,
      'packages/newcomer/package.json': pkg('@arch-canvas/newcomer', { 'test:unit': 'vitest run' }),
      'packages/newcomer/vitest.config.ts': WITH_FLOOR.replace(
        /thresholds: \{[\s\S]*?\},/,
        'thresholds: {},',
      ),
    });

    const violations = checkCoverageFloors(root);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.package).toBe('packages/newcomer');
  });

  it('accepts a package that declares a numeric floor', () => {
    const root = fakeRepo({
      'pnpm-workspace.yaml': WORKSPACE,
      'packages/covered/package.json': pkg('@arch-canvas/covered', { 'test:unit': 'vitest run' }),
      'packages/covered/vitest.config.ts': WITH_FLOOR,
      'infra/backup/package.json': pkg('@arch-canvas/backup', { 'test:unit': 'vitest run' }),
      'infra/backup/vitest.config.ts': WITH_FLOOR,
    });

    expect(checkCoverageFloors(root)).toEqual([]);
  });

  it('does not demand a floor from a package that has no test:unit script', () => {
    const root = fakeRepo({
      'pnpm-workspace.yaml': WORKSPACE,
      'packages/database/package.json': pkg('@arch-canvas/database', {
        build: 'tsc -p tsconfig.build.json',
        'test:integration': 'vitest run -c vitest.integration.config.ts',
      }),
    });

    expect(checkCoverageFloors(root)).toEqual([]);
  });

  it('reports nothing when the root declares no workspace at all', () => {
    expect(checkCoverageFloors(fakeRepo({}))).toEqual([]);
  });

  it('passes against the real repository, where every unit-tested package has a floor', () => {
    expect(checkCoverageFloors(REPO_ROOT)).toEqual([]);
  });
});
