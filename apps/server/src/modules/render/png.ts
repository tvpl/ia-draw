import { Resvg } from '@resvg/resvg-js';

/**
 * Rasterizes an SVG string to a PNG buffer.
 *
 * Real API, verified in node_modules/@resvg/resvg-js/index.d.ts:
 *   new Resvg(svg: Buffer | string, options?: ResvgRenderOptions | null)
 *   Resvg#render(): RenderedImage
 *   RenderedImage#asPng(): Buffer
 */
export function rasterizeSvgToPng(svg: string): Buffer {
  const resvg = new Resvg(svg);
  return resvg.render().asPng();
}
