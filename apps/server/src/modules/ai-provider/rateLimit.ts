import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Reusable per-process rate-limit middleware (design.md AIC-04: "rate limits
 * ... por usuário e por workspace"). A simple fixed-window in-memory counter
 * — the real `ai/runs` orchestration (F2c) is out of scope here; this task
 * only delivers the limiter itself, testable in isolation and pluggable
 * onto any route via `key`.
 */
export interface RateLimiterOptions {
  /** Max requests allowed per window, per key. */
  limit: number;
  windowMs: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

export interface RateLimitCheck {
  allowed: boolean;
  remaining: number;
}

export class InMemoryRateLimiter {
  private readonly windows = new Map<string, { windowStart: number; count: number }>();
  private readonly now: () => number;

  constructor(private readonly options: RateLimiterOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Records one hit for `key` and reports whether it is within the configured limit. */
  check(key: string): RateLimitCheck {
    const now = this.now();
    const entry = this.windows.get(key);

    if (!entry || now - entry.windowStart >= this.options.windowMs) {
      this.windows.set(key, { windowStart: now, count: 1 });
      return { allowed: true, remaining: this.options.limit - 1 };
    }

    entry.count += 1;
    return {
      allowed: entry.count <= this.options.limit,
      remaining: Math.max(0, this.options.limit - entry.count),
    };
  }
}

/** Wraps `limiter` as a Fastify `preHandler`, keyed by `keyFn(request)` — 429 once the window's limit is exceeded. */
export function createRateLimitPreHandler(
  limiter: InMemoryRateLimiter,
  keyFn: (request: FastifyRequest) => string,
) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const result = limiter.check(keyFn(request));
    if (!result.allowed) {
      throw Object.assign(new Error('Too Many Requests'), { statusCode: 429 });
    }
  };
}
