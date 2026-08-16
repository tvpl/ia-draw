import { describe, expect, it } from 'vitest';
import { runThresholdCheck } from './runThresholdCheck.js';

describe('runThresholdCheck (T27, API-03)', () => {
  it('exits 0 and prints the passed/total count when every injected result passes', () => {
    const messages: string[] = [];

    const exitCode = runThresholdCheck({
      runEvals: () => [{ passed: true }, { passed: true }],
      log: (message) => messages.push(message),
    });

    expect(exitCode).toBe(0);
    expect(messages).toEqual(['2/2 evals passed, limiar 100%']);
  });

  it('exits non-zero and cites the real rate/threshold when a simulated result is below threshold', () => {
    const messages: string[] = [];

    const exitCode = runThresholdCheck({
      runEvals: () => [{ passed: true }, { passed: false }],
      log: (message) => messages.push(message),
    });

    expect(exitCode).toBe(1);
    expect(messages).toEqual(['1/2 evals passed, limiar 100%']);
  });
});
