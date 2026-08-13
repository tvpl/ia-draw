import { restoreElements } from '@excalidraw/excalidraw';
import { describe, expect, it } from 'vitest';
import { generateScene } from './generateScene.js';

type RestoreInput = Parameters<typeof restoreElements>[0];

describe('generateScene', () => {
  it.each([1000, 5000])('produces exactly %i elements', (elementCount) => {
    const elements = generateScene(elementCount, 42);

    expect(elements).toHaveLength(elementCount);
  });

  it.each([1000, 5000])(
    'produces %i well-formed elements accepted by restoreElements',
    (elementCount) => {
      const elements = generateScene(elementCount, 42);

      const restored = restoreElements(elements as unknown as RestoreInput, null);

      expect(restored).toHaveLength(elementCount);
      for (const element of restored) {
        expect(typeof element.id).toBe('string');
        expect(['rectangle', 'text', 'arrow']).toContain(element.type);
        expect(element.isDeleted).toBe(false);
      }
    },
  );

  it('produces a roughly even split across rectangle/text/arrow (exact round-robin)', () => {
    const elements = generateScene(999, 1);
    const counts: Record<string, number> = { rectangle: 0, text: 0, arrow: 0 };
    for (const element of elements) {
      const kind = element.type;
      counts[kind] = (counts[kind] ?? 0) + 1;
    }

    expect(counts.rectangle).toBe(333);
    expect(counts.text).toBe(333);
    expect(counts.arrow).toBe(333);
  });

  it.each([1000, 5000])(
    'produces byte-identical output for two calls with the same seed (%i elements)',
    (elementCount) => {
      const first = generateScene(elementCount, 42);
      const second = generateScene(elementCount, 42);

      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    },
  );

  it('produces different output for a different seed', () => {
    const seedA = generateScene(100, 1);
    const seedB = generateScene(100, 2);

    expect(JSON.stringify(seedB)).not.toBe(JSON.stringify(seedA));
  });
});
