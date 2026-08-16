#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkEvalThreshold, EVAL_SUCCESS_THRESHOLD, type EvalCaseOutcome } from './threshold.js';

/** The existing deterministic eval suite (T57) — never rewritten, only read. */
const EVALS_SPEC_PATH = 'src/modules/ai-engine/evals/evals.spec.ts';

/** The subset of Vitest's (Jest-compatible) `--reporter=json` shape this script reads. */
interface VitestJsonReport {
  testResults: Array<{
    assertionResults: Array<{ status: string }>;
  }>;
}

/**
 * Runs the real `evals.spec.ts` suite through Vitest's JSON reporter and
 * flattens every case into a pass/fail outcome. Coverage is disabled for
 * this run — this script only reads pass/fail, and running coverage twice
 * (once here, once for the normal `test:unit` gate) would be redundant.
 * A failing eval case makes the `vitest run` process exit non-zero; that
 * exit code is intentionally ignored here — this script's own pass/fail
 * comes from `checkEvalThreshold` below, not from Vitest's exit code.
 *
 * `@arch-canvas/server`'s package root is resolved lazily, inside this
 * function, rather than at module load time: computed eagerly, `new URL()`
 * resolution against `import.meta.url` breaks under the jsdom test
 * environment `runThresholdCheck.spec.ts` runs in (jsdom's global `URL`
 * does not honor the relative-to-base resolution here). Every unit test
 * injects `runEvals`, so this function — and this resolution — never runs
 * under jsdom; it only runs for real, under plain Node, when this script is
 * actually invoked.
 */
function runEvalsSpec(): EvalCaseOutcome[] {
  const serverRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  const scratchDir = mkdtempSync(join(tmpdir(), 'ai-evals-report-'));
  const outputFile = join(scratchDir, 'report.json');

  try {
    try {
      execFileSync(
        'pnpm',
        [
          'exec',
          'vitest',
          'run',
          EVALS_SPEC_PATH,
          '--reporter=json',
          `--outputFile=${outputFile}`,
          '--coverage.enabled=false',
        ],
        { cwd: serverRoot, stdio: ['ignore', 'ignore', 'inherit'] },
      );
    } catch {
      // See doc comment above: a failing case exits non-zero, the report is
      // still written.
    }

    const report = JSON.parse(readFileSync(outputFile, 'utf8')) as VitestJsonReport;
    return report.testResults.flatMap((file) =>
      file.assertionResults.map((assertion) => ({ passed: assertion.status === 'passed' })),
    );
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

export interface RunThresholdCheckOptions {
  /** Injectable for tests — defaults to actually running `evals.spec.ts` through Vitest. */
  runEvals?: () => EvalCaseOutcome[];
  /** Defaults to `EVAL_SUCCESS_THRESHOLD`. */
  threshold?: number;
  /** Injectable so tests can assert on the printed message instead of touching stdout. */
  log?: (message: string) => void;
}

/**
 * Wraps the existing deterministic eval suite with an explicit threshold
 * check (T27, API-03): prints "X/Y evals passed, limiar Z%" — naming the
 * real numbers, never letting a below-threshold run pass silently — and
 * returns the process exit code the CLI entrypoint below uses (0 = met the
 * threshold).
 */
export function runThresholdCheck(options: RunThresholdCheckOptions = {}): number {
  const threshold = options.threshold ?? EVAL_SUCCESS_THRESHOLD;
  const log = options.log ?? ((message: string) => process.stdout.write(`${message}\n`));
  const results = (options.runEvals ?? runEvalsSpec)();

  const passedCount = results.filter((result) => result.passed).length;
  const { ok } = checkEvalThreshold(results, threshold);

  log(`${passedCount}/${results.length} evals passed, limiar ${Math.round(threshold * 100)}%`);

  return ok ? 0 : 1;
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (entryUrl === import.meta.url) {
  process.exitCode = runThresholdCheck();
}
