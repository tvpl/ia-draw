import { describe, expect, it } from 'vitest';
import {
  cursorQuerySchema,
  DEFAULT_PAGE_LIMIT,
  decodeCursor,
  encodeCursor,
  MAX_PAGE_LIMIT,
} from './pagination.js';

describe('cursor pagination (spec §7 — paginação cursor-based)', () => {
  it('applies the default limit when none is given', () => {
    expect(cursorQuerySchema.parse({}).limit).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('rejects a limit above the maximum', () => {
    expect(cursorQuerySchema.safeParse({ limit: MAX_PAGE_LIMIT + 1 }).success).toBe(false);
  });

  it('rejects a non-positive limit', () => {
    expect(cursorQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('round-trips a cursor payload', () => {
    const cursor = encodeCursor({ k: 'sequence', v: 42 });
    expect(decodeCursor(cursor)).toEqual({ k: 'sequence', v: 42 });
  });

  it('returns null for a malformed cursor instead of throwing', () => {
    expect(decodeCursor('%%%not-base64%%%')).toBeNull();
    expect(decodeCursor(Buffer.from('{"junk":true}').toString('base64url'))).toBeNull();
  });
});
