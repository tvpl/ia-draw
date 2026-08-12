import { describe, expect, it } from 'vitest';
import { LIBRARY_MANIFEST } from './manifest.js';
import { CATEGORIES, libraryItemSchema, libraryManifestSchema } from './schema.js';

describe('library-content manifest (T37, spec.md LIB-01)', () => {
  it('validates against the Zod manifest schema', () => {
    expect(() => libraryManifestSchema.parse(LIBRARY_MANIFEST)).not.toThrow();
  });

  it('every item has a non-empty license and attribution (the central LIB-01 guarantee)', () => {
    for (const item of LIBRARY_MANIFEST.items) {
      expect(item.license.length).toBeGreaterThan(0);
      expect(item.attribution.length).toBeGreaterThan(0);
    }
  });

  it('rejects an item with an empty license — the schema is the enforcement, not convention', () => {
    const invalid = {
      stableKey: 'generic.compute.server',
      name: 'Server',
      category: 'compute',
      description: 'x',
      color: '#123456',
      icon: { kind: 'inline', svg: '<svg/>' },
      version: '1.0.0',
      license: '',
      attribution: 'someone',
    };
    expect(() => libraryItemSchema.parse(invalid)).toThrow();
  });

  it('rejects an item with an empty attribution', () => {
    const invalid = {
      stableKey: 'generic.compute.server',
      name: 'Server',
      category: 'compute',
      description: 'x',
      color: '#123456',
      icon: { kind: 'inline', svg: '<svg/>' },
      version: '1.0.0',
      license: 'CC0-1.0',
      attribution: '',
    };
    expect(() => libraryItemSchema.parse(invalid)).toThrow();
  });

  it('rejects an item missing license/attribution entirely', () => {
    const invalid = {
      stableKey: 'generic.compute.server',
      name: 'Server',
      category: 'compute',
      description: 'x',
      color: '#123456',
      icon: { kind: 'inline', svg: '<svg/>' },
      version: '1.0.0',
    };
    expect(() => libraryItemSchema.parse(invalid)).toThrow();
  });

  it('covers all 12 categories from the source document with at least one generic component each', () => {
    expect(CATEGORIES).toHaveLength(12);
    const genericItems = LIBRARY_MANIFEST.items.filter((item) =>
      item.stableKey.startsWith('generic.'),
    );
    const coveredCategories = new Set(genericItems.map((item) => item.category));
    for (const category of CATEGORIES) {
      expect(coveredCategories.has(category)).toBe(true);
    }
  });

  it('ships at least 5 real AWS components with a verified, documented license', () => {
    const awsItems = LIBRARY_MANIFEST.items.filter((item) => item.stableKey.startsWith('aws.'));
    expect(awsItems.length).toBeGreaterThanOrEqual(5);
    for (const item of awsItems) {
      expect(item.license).toBe('CC-BY-ND-2.0');
      expect(item.attribution).toContain('Amazon Web Services');
      // Verified indirectly (aws.amazon.com is unreachable from this sandbox) — the
      // icon is an external reference to the authoritative source, never fabricated
      // inline artwork, and the reference documents exactly how it was verified.
      expect(item.icon.kind).toBe('external');
      if (item.icon.kind === 'external') {
        expect(item.icon.sourceUrl).toBe('https://aws.amazon.com/architecture/icons/');
        expect(item.icon.note.length).toBeGreaterThan(0);
      }
    }
  });

  it('has no duplicate stableKey — the library resolves components by this key (design.md compile())', () => {
    const keys = LIBRARY_MANIFEST.items.map((item) => item.stableKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
