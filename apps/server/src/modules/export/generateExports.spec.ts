import { allFixtures } from '@arch-canvas/test-fixtures';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_APP_STATE, generateExports } from './generateExports.js';
import { svgToPdfBuffer } from './pdf.js';
import { parseScene } from './sceneFile.js';

const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_SIGNATURE = '%PDF-';

describe('generateExports', () => {
  for (const [fixtureName, elements] of Object.entries(allFixtures)) {
    it(`generates all 4 formats for the "${fixtureName}" fixture without throwing`, async () => {
      const formats = await generateExports(elements as never);

      expect(formats.excalidraw.length).toBeGreaterThan(0);
      expect(formats.svg.length).toBeGreaterThan(0);
      expect(formats.png.length).toBeGreaterThan(0);
      expect(formats.pdf.length).toBeGreaterThan(0);
    });
  }

  it('produces a .excalidraw file that is reimportable via parseScene (T32 Done-when)', async () => {
    const elements = allFixtures.frame;
    const formats = await generateExports(elements as never);

    const parsed = parseScene(formats.excalidraw.toString('utf8'));

    expect(parsed.elements).toEqual(elements);
    expect(parsed.appState).toEqual(DEFAULT_EXPORT_APP_STATE);
  });

  it('produces a PNG buffer starting with the PNG magic bytes', async () => {
    const formats = await generateExports(allFixtures.text as never);
    expect(formats.png.subarray(0, 8)).toEqual(PNG_MAGIC_BYTES);
  });

  it('produces a PDF buffer starting with the %PDF- signature (T32 Done-when)', async () => {
    const formats = await generateExports(allFixtures.text as never);
    expect(formats.pdf.subarray(0, 5).toString('latin1')).toBe(PDF_SIGNATURE);
  });

  it('produces a PDF containing real rendered content, not a blank page (T32 Done-when)', async () => {
    const formats = await generateExports(allFixtures.text as never);

    // Compressed production output (default) starts with the PDF signature — asserted
    // above. To prove the page isn't blank without a separate FlateDecode step, this
    // regenerates the same scene's PDF uncompressed and inspects the raw content
    // stream for real drawing operators (text show / fill / stroke / path
    // construction) — a blank `doc.addPage(); doc.end();` page contains none of them.
    const svg = formats.svg.toString('utf8');
    const uncompressed = await svgToPdfBuffer(svg, { compress: false });
    const content = uncompressed.toString('latin1');

    // A blank `doc.addPage(); doc.end();` page (verified separately) contains neither
    // operator — `BT`/`Tj` bracket the "Hello architecture canvas" text run this
    // fixture actually draws.
    expect(content).toMatch(/\bBT\b/);
    expect(content).toMatch(/\bTj\b/);
  });
});
