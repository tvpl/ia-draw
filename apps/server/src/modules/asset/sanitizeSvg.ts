import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitizes an uploaded SVG with DOMPurify's restricted SVG profile
 * (`USE_PROFILES: { svg: true, svgFilters: false }`) — allows only SVG/SVG
 * Filters markup, strips `<script>`, event handlers (`onload`, etc.) and
 * external references DOMPurify treats as unsafe by default. Returns the
 * sanitized markup as a Buffer, ready to overwrite the uploaded object.
 */
export function sanitizeSvg(raw: Buffer): Buffer {
  const clean = DOMPurify.sanitize(raw.toString('utf8'), {
    USE_PROFILES: { svg: true, svgFilters: false },
  });
  return Buffer.from(clean, 'utf8');
}
