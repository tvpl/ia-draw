import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter } from './rateLimit.js';

describe('InMemoryRateLimiter (T42, AIC-04)', () => {
  it('allows calls up to the configured limit within a window', () => {
    const limiter = new InMemoryRateLimiter({ limit: 3, windowMs: 60_000 });
    expect(limiter.check('user-1').allowed).toBe(true);
    expect(limiter.check('user-1').allowed).toBe(true);
    expect(limiter.check('user-1').allowed).toBe(true);
  });

  it('rejects the N+1-th call within the same window', () => {
    const limiter = new InMemoryRateLimiter({ limit: 3, windowMs: 60_000 });
    limiter.check('user-1');
    limiter.check('user-1');
    limiter.check('user-1');
    const fourth = limiter.check('user-1');
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it('tracks each key independently — one user hitting the limit does not affect another', () => {
    const limiter = new InMemoryRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.check('user-1').allowed).toBe(true);
    expect(limiter.check('user-1').allowed).toBe(false);
    expect(limiter.check('user-2').allowed).toBe(true);
  });

  it('resets the count once the window elapses', () => {
    let now = 0;
    const limiter = new InMemoryRateLimiter({ limit: 1, windowMs: 1000, now: () => now });

    expect(limiter.check('user-1').allowed).toBe(true);
    expect(limiter.check('user-1').allowed).toBe(false);

    now = 1000; // exactly one window later
    expect(limiter.check('user-1').allowed).toBe(true);
  });
});
