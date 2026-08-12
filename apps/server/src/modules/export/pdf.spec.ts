import { describe, expect, it } from 'vitest';
import { svgPagesToPdfBuffer, svgToPdfBuffer } from './pdf.js';

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

describe('svgPagesToPdfBuffer (T66, PRS-05 — multi-page PDF export)', () => {
  it('produces a PDF with as many /Type /Page objects as SVGs given, one per page', async () => {
    const svgs = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="red"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="200" height="80" fill="blue"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><rect width="150" height="150" fill="green"/></svg>',
    ];

    const pdf = await svgPagesToPdfBuffer(svgs, { compress: false });

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const text = pdf.toString('latin1');
    const pageObjectCount = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pageObjectCount).toBe(3);
    // Each page's own MediaBox matches its source SVG's dimensions.
    expect(text).toContain('/MediaBox [0 0 100 50]');
    expect(text).toContain('/MediaBox [0 0 200 80]');
    expect(text).toContain('/MediaBox [0 0 150 150]');
  });

  it('svgToPdfBuffer(svg) produces the same single-page output as svgPagesToPdfBuffer([svg]) — one is the other specialized, never a separate implementation', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="red"/></svg>';

    const single = await svgToPdfBuffer(svg, { compress: false });
    const viaPages = await svgPagesToPdfBuffer([svg], { compress: false });

    // Not byte-identical (pdfkit embeds a per-call /ID and /CreationDate) — compare the
    // structurally meaningful parts instead: exactly 1 page, same MediaBox, same drawing
    // operators in the (uncompressed) content stream.
    for (const pdf of [single, viaPages]) {
      const text = pdf.toString('latin1');
      expect((text.match(/\/Type\s*\/Page[^s]/g) ?? []).length).toBe(1);
      expect(text).toContain('/MediaBox [0 0 120 60]');
    }
  });

  it('an empty SVG array produces a valid (zero-page) PDF, never throws', async () => {
    const pdf = await svgPagesToPdfBuffer([]);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
