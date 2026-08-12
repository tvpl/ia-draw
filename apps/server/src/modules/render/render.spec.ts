import { allFixtures } from '@arch-canvas/test-fixtures';
import { describe, expect, it } from 'vitest';
import { rasterizeSvgToPng } from './png.js';
import type { RenderElements } from './svg.js';
import { renderSceneToSvg } from './svg.js';

const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('renderSceneToSvg + rasterizeSvgToPng', () => {
  it('renders the text fixture to an SVG containing the literal text and sane dimensions', async () => {
    const elements = allFixtures.text as unknown as RenderElements;

    const svg = await renderSceneToSvg(elements);

    expect(svg).toContain('Hello architecture canvas');
    expect(svg).toMatch(/<svg[^>]*width="([\d.]+)"/);
    expect(svg).toMatch(/<svg[^>]*height="([\d.]+)"/);
    const widthMatch = svg.match(/<svg[^>]*width="([\d.]+)"/);
    const heightMatch = svg.match(/<svg[^>]*height="([\d.]+)"/);
    expect(Number(widthMatch?.[1])).toBeGreaterThan(0);
    expect(Number(heightMatch?.[1])).toBeGreaterThan(0);
  });

  it('rasterizes the text fixture SVG to a non-empty PNG buffer with the correct magic bytes', async () => {
    const elements = allFixtures.text as unknown as RenderElements;
    const svg = await renderSceneToSvg(elements);

    const png = rasterizeSvgToPng(svg);

    expect(png.length).toBeGreaterThan(0);
    expect(png.subarray(0, 8)).toEqual(PNG_MAGIC_BYTES);
  });

  for (const [fixtureName, elements] of Object.entries(allFixtures)) {
    it(`renders the "${fixtureName}" fixture to SVG and PNG without throwing`, async () => {
      const svg = await renderSceneToSvg(elements as unknown as RenderElements);
      expect(svg.length).toBeGreaterThan(0);

      const png = rasterizeSvgToPng(svg);
      expect(png.length).toBeGreaterThan(0);
      expect(png.subarray(0, 8)).toEqual(PNG_MAGIC_BYTES);
    });
  }
});
