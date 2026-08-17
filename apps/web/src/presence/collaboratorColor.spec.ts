import { describe, expect, it } from 'vitest';
import { collaboratorColor } from './collaboratorColor.js';

describe('collaboratorColor (T6, LIVE-15)', () => {
  it('returns the same pair for the same senderId, every time', () => {
    const first = collaboratorColor('7cb2b6a0-98c1-4e0c-9d1f-2b3c4d5e6f71');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(collaboratorColor('7cb2b6a0-98c1-4e0c-9d1f-2b3c4d5e6f71')).toEqual(first);
    }
  });

  it('spreads distinct senderIds across more than one palette entry', () => {
    const ids = Array.from({ length: 40 }, (_, index) => `user-${index}`);
    const distinct = new Set(ids.map((id) => collaboratorColor(id).background));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('returns well-formed hex colours for background and stroke', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
      const color = collaboratorColor(id);
      expect(color.background).toMatch(/^#[0-9a-f]{6}$/);
      expect(color.stroke).toMatch(/^#[0-9a-f]{6}$/);
      expect(color.stroke).not.toBe(color.background);
    }
  });
});
