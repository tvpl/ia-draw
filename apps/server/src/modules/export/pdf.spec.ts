import { describe, expect, it } from 'vitest';
import { svgToPdfBuffer } from './pdf.js';

describe('svgToPdfBuffer', () => {
  it('produces a buffer with the %PDF- signature for an SVG with explicit dimensions', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="red"/></svg>';

    const pdf = await svgToPdfBuffer(svg);

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('falls back to a default page size when the SVG has no width/height attributes', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="blue"/></svg>';

    const pdf = await svgToPdfBuffer(svg);

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // US Letter in points (612x792) is the documented fallback; MediaBox is written
    // uncompressed regardless of the page content stream's own compression setting.
    expect(pdf.toString('latin1')).toContain('/MediaBox [0 0 612 792]');
  });
});
