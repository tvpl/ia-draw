import { describe, expect, it } from 'vitest';
import { diagramIdSchema, uuidSchema } from './ids.js';

describe('id schemas (spec §7 — IDs UUID)', () => {
  it('accepts a valid uuid', () => {
    const id = '4fa2b6a0-98c1-4e0c-9d1f-2b3c4d5e6f70';
    expect(uuidSchema.parse(id)).toBe(id);
    expect(diagramIdSchema.parse(id)).toBe(id);
  });

  it('rejects non-uuid strings', () => {
    expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false);
    expect(uuidSchema.safeParse('').success).toBe(false);
    expect(diagramIdSchema.safeParse('1234').success).toBe(false);
  });
});
