import { describe, expect, it } from 'vitest';
import { PROBLEM_CONTENT_TYPE, problem, problemDetailsSchema } from './problem.js';

describe('problem details (RFC 9457 — spec §7)', () => {
  it('serializes with the problem+json media type constant', () => {
    expect(PROBLEM_CONTENT_TYPE).toBe('application/problem+json');
  });

  it('builds a valid problem with status, title and defaulted type', () => {
    const p = problem(403, 'Forbidden', { requestId: 'req-1' });
    expect(p.status).toBe(403);
    expect(p.title).toBe('Forbidden');
    expect(p.type).toBe('about:blank');
    expect(p.requestId).toBe('req-1');
  });

  it('rejects a status outside the HTTP range', () => {
    expect(problemDetailsSchema.safeParse({ title: 'x', status: 99 }).success).toBe(false);
    expect(problemDetailsSchema.safeParse({ title: 'x', status: 600 }).success).toBe(false);
  });

  it('rejects an empty title', () => {
    expect(problemDetailsSchema.safeParse({ title: '', status: 400 }).success).toBe(false);
  });
});
