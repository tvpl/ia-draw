import { describe, expect, it } from 'vitest';
import { LIBRARY_MANIFEST } from '../manifest.js';
import { libraryItemSchema } from '../schema.js';
import { WIREFRAME_LOFI_ITEMS } from './wireframe-lofi.js';

describe('wireframe-lofi preset (T67, PRS-04)', () => {
  it('ships at least 4 components — screen, button, input, list — each with a unique, resolvable stableKey', () => {
    expect(WIREFRAME_LOFI_ITEMS.length).toBeGreaterThanOrEqual(4);
    const keys = WIREFRAME_LOFI_ITEMS.map((item) => item.stableKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const requiredKey of [
      'wireframe.screen.blank',
      'wireframe.button.primary',
      'wireframe.input.text',
      'wireframe.list.item',
    ]) {
      expect(keys).toContain(requiredKey);
    }
  });

  it('every item is a valid LibraryItem tagged category "wireframe" with license+attribution', () => {
    for (const item of WIREFRAME_LOFI_ITEMS) {
      expect(() => libraryItemSchema.parse(item)).not.toThrow();
      expect(item.category).toBe('wireframe');
      expect(item.license.length).toBeGreaterThan(0);
      expect(item.attribution.length).toBeGreaterThan(0);
    }
  });

  it('is wired into the manifest — every wireframe stableKey resolves through LIBRARY_MANIFEST (the same path compile()/search_library use)', () => {
    const manifestKeys = new Set(LIBRARY_MANIFEST.items.map((item) => item.stableKey));
    for (const item of WIREFRAME_LOFI_ITEMS) {
      expect(manifestKeys.has(item.stableKey)).toBe(true);
    }
  });
});
