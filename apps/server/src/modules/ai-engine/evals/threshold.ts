/**
 * Success threshold for the deterministic eval suite (`evals.spec.ts`, T57,
 * API-03). 100% today because every case is fully deterministic — a fixed
 * mock provider, no real model, no network call (see `evals.spec.ts`'s own
 * header). The mechanism (`checkEvalThreshold`) already exists for a future
 * wave that wires a real provider and stops being 100% reproducible; this
 * constant is what changes then, not the checker itself.
 */
export const EVAL_SUCCESS_THRESHOLD = 1.0;

/** One eval case's outcome, decoupled from how the caller obtained it (Vitest, a fixture, etc). */
export interface EvalCaseOutcome {
  passed: boolean;
}

export interface EvalThresholdResult {
  /** Fraction of `results` that passed, in `[0, 1]`. */
  rate: number;
  /** Whether `rate` meets or exceeds `threshold`. */
  ok: boolean;
}

/**
 * Compares the pass rate of `results` against `threshold` (API-03). An empty
 * `results` list never divides by zero and never reports `ok: true` — same
 * "an empty set proves nothing" rule `checkCapabilityMap`
 * (`tools/repo-tools`) already applies to an empty capability map.
 */
export function checkEvalThreshold(
  results: EvalCaseOutcome[],
  threshold: number,
): EvalThresholdResult {
  if (results.length === 0) {
    return { rate: 0, ok: false };
  }

  const passedCount = results.filter((result) => result.passed).length;
  const rate = passedCount / results.length;

  return { rate, ok: rate >= threshold };
}
