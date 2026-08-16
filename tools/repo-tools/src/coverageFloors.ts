import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

/** One workspace package that runs unit tests without declaring a coverage floor. */
export interface CoverageFloorViolation {
  /** The offending package, by its directory relative to the repo root. */
  package: string;
  problem: string;
}

/** Where the monorepo declares which directories are workspace packages. */
const WORKSPACE_FILE = 'pnpm-workspace.yaml';

/** The vitest config `vitest run` picks up by default — where the floor lives. */
const VITEST_CONFIG = 'vitest.config.ts';

/**
 * True when the config declares at least one numeric coverage threshold. An
 * empty `thresholds: {}` declares no floor and does not count.
 */
function declaresCoverageThresholds(config: string): boolean {
  const coverage = config.indexOf('coverage:');
  if (coverage < 0) return false;

  return /thresholds\s*:\s*\{[^}]*\w+\s*:\s*\d/.test(config.slice(coverage));
}

function directoriesIn(root: string, prefix: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(join(root, ...prefix.split('/')), { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${prefix}/${entry.name}`)
    .sort();
}

/**
 * Expands the `packages:` globs of pnpm-workspace.yaml into package directories,
 * relative to the repo root. Only the `dir/*` form the monorepo uses is
 * expanded; any other entry is taken as a literal directory.
 */
function workspacePackages(sourceRoot: string): string[] {
  const workspacePath = join(sourceRoot, WORKSPACE_FILE);
  if (!existsSync(workspacePath)) return [];

  const declared = (parse(readFileSync(workspacePath, 'utf8')) as { packages?: unknown } | null)
    ?.packages;
  if (!Array.isArray(declared)) return [];

  const directories: string[] = [];
  for (const pattern of declared) {
    if (typeof pattern !== 'string') continue;
    if (pattern.endsWith('/*'))
      directories.push(...directoriesIn(sourceRoot, pattern.slice(0, -2)));
    else directories.push(pattern);
  }
  return directories;
}

/**
 * Fails every workspace package that exposes a `test:unit` script without
 * declaring a coverage floor (CIQ-04, edge case "package novo sem piso"). A
 * package with no unit-test script is not asked for a floor; one that runs
 * tests without a threshold would ship uncovered code and stay green.
 */
export function checkCoverageFloors(sourceRoot: string): CoverageFloorViolation[] {
  const violations: CoverageFloorViolation[] = [];

  for (const directory of workspacePackages(sourceRoot)) {
    const manifestPath = join(sourceRoot, ...directory.split('/'), 'package.json');
    if (!existsSync(manifestPath)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    if (!manifest.scripts?.['test:unit']) continue;

    const configPath = join(sourceRoot, ...directory.split('/'), VITEST_CONFIG);
    if (!existsSync(configPath)) {
      violations.push({
        package: directory,
        problem: `declares a \`test:unit\` script but has no ${VITEST_CONFIG} to declare a coverage floor in`,
      });
      continue;
    }

    if (!declaresCoverageThresholds(readFileSync(configPath, 'utf8'))) {
      violations.push({
        package: directory,
        problem: `declares a \`test:unit\` script without a \`coverage.thresholds\` floor in ${VITEST_CONFIG}`,
      });
    }
  }

  return violations;
}
