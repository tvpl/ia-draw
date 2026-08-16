import { describe, expect, it } from 'vitest';
import { checkEvalThreshold, EVAL_SUCCESS_THRESHOLD } from './threshold.js';

describe('checkEvalThreshold (API-03)', () => {
  it('reports ok: true with rate 1 when every case passes at the 100% threshold', () => {
    const result = checkEvalThreshold(
      [{ passed: true }, { passed: true }, { passed: true }],
      EVAL_SUCCESS_THRESHOLD,
    );

    expect(result).toEqual({ rate: 1, ok: true });
  });

  it('reports ok: false with the real rate when below the threshold', () => {
    const result = checkEvalThreshold(
      [{ passed: true }, { passed: true }, { passed: true }, { passed: false }],
      EVAL_SUCCESS_THRESHOLD,
    );

    expect(result.rate).toBe(0.75);
    expect(result.ok).toBe(false);
  });

  it('honors a custom threshold below 100%', () => {
    const results = [{ passed: true }, { passed: true }, { passed: true }, { passed: false }];

    // 75% pass rate: ok against an 0.7 threshold, not ok against the default 1.0.
    expect(checkEvalThreshold(results, 0.7)).toEqual({ rate: 0.75, ok: true });
    expect(checkEvalThreshold(results, EVAL_SUCCESS_THRESHOLD).ok).toBe(false);
  });

  it('does not divide by zero on an empty result list, and never reports ok', () => {
    expect(checkEvalThreshold([], EVAL_SUCCESS_THRESHOLD)).toEqual({ rate: 0, ok: false });
    // Even a threshold of 0 must not treat "no evals ran" as a pass.
    expect(checkEvalThreshold([], 0)).toEqual({ rate: 0, ok: false });
  });
});
