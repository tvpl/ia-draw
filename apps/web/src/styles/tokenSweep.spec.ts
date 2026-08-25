import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * UIF-03/13: the two things that, left unchecked, take this application straight back to
 * where it started — a literal colour typed into a component, and a second layout mechanism
 * living alongside the first. The nine inline styles this replaced were all in the editor
 * route, and they are exactly where the side panel started overlapping the canvas.
 *
 * `presence/collaboratorColor.ts` is exempt and named here rather than silently skipped: it
 * derives a stable cursor colour per participant, which is domain logic about telling people
 * apart, not styling. Any other exemption needs the same kind of written reason.
 */
const EXEMPT = new Set(['presence/collaboratorColor.ts']);

/** Strips comments so `React error #185` in prose is not mistaken for a colour. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function productionSources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...productionSources(absolute));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.spec\.tsx?$/.test(entry)) continue;
    const path = relative(SRC_ROOT, absolute);
    if (EXEMPT.has(path)) continue;
    found.push(path);
  }
  return found;
}

const HEX_COLOR = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/;
const CSS_COLOR_FUNCTION = /\b(?:rgb|rgba|hsl|hsla|oklch)\s*\(/;

describe('token sweep (UIF-03, UIF-13)', () => {
  const sources = productionSources(SRC_ROOT).map((path) => ({
    path,
    source: withoutComments(readFileSync(join(SRC_ROOT, path), 'utf8')),
  }));

  it('scans a plausible number of files — zero would mean the walker broke', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it('finds no literal colour in a production component', () => {
    const offenders = sources
      .filter(({ source }) => HEX_COLOR.test(source) || CSS_COLOR_FUNCTION.test(source))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it('finds no inline style object in a production component', () => {
    const offenders = sources
      .filter(({ source }) => source.includes('style={{'))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });
});
