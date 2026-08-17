/**
 * Pure client-side parsing for a docgen Markdown document (T3, spec.md LDC-13..17). No I/O, no
 * DOM — only string transforms, so `SpecViewer` (T4) can stay a display component.
 *
 * `apps/web` cannot import `apps/server/src/modules/docgen/sections.ts` (different app, no shared
 * package) — the 4 fixed heading strings below are duplicated from that server source of truth on
 * purpose, not rediscovered. They are read-only: `assembleMarkdown`/`sectionHeading` in
 * `sections.ts` always emit exactly these 4 Portuguese titles, in this order, and this module is
 * never fed anything other than Markdown those functions produced (spec.md's Out of Scope: the
 * generated document body is never translated).
 */

export const SECTION_NAMES = ['overview', 'components', 'flows', 'decisions'] as const;
export type SectionName = (typeof SECTION_NAMES)[number];

/** Mirrors `apps/server/src/modules/docgen/sections.ts`'s `SECTION_TITLES` — do not localize. */
const SECTION_TITLES: Record<SectionName, string> = {
  overview: 'Visão Geral',
  components: 'Componentes',
  flows: 'Fluxos',
  decisions: 'Decisões',
};

function sectionHeading(name: SectionName): string {
  return `## ${SECTION_TITLES[name]}`;
}

/**
 * Splits a docgen Markdown document into its 4 fixed sections (LDC-13). Mirrors the server's own
 * `parseMarkdownSections` (`regenerateSection.ts`) split algorithm exactly, so a document round-
 * trips identically on both sides. Tolerant of a missing or reordered heading: a heading the
 * document does not contain yields an empty string for that section, never a thrown error
 * (Edge Cases: a malformed document must never take down the whole panel).
 */
export function parseSpecSections(markdown: string): Record<SectionName, string> {
  const result = {} as Record<SectionName, string>;
  const headingIndexes = SECTION_NAMES.map((name) => ({
    name,
    index: markdown.indexOf(`\n${sectionHeading(name)}\n`),
  })).sort((a, b) => a.index - b.index);

  for (let i = 0; i < headingIndexes.length; i++) {
    const current = headingIndexes[i];
    if (!current || current.index === -1) continue;
    const contentStart = current.index + `\n${sectionHeading(current.name)}\n`.length;
    const next = headingIndexes[i + 1];
    const contentEnd = next && next.index !== -1 ? next.index : markdown.length;
    result[current.name] = markdown.slice(contentStart, contentEnd).trim();
  }

  for (const name of SECTION_NAMES) {
    if (result[name] === undefined) result[name] = '';
  }
  return result;
}

const BACKTICK_TOKEN_RE = /`([^`]+)`/g;

/**
 * Extracts every distinct backtick-quoted token from a section's body, in first-appearance order
 * (LDC-14/15) — the same format `buildComponentsSection`/`buildFlowsSection`/
 * `buildDecisionsSection` (server `sections.ts`) already use to embed an `elementId`. `overview`'s
 * body never contains a backtick (`buildOverviewSection` only emits counts), so calling this on an
 * overview body always returns `[]` by construction, not by a special case here (LDC-17).
 */
export function extractReferencedElementIds(sectionBody: string): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const match of sectionBody.matchAll(BACKTICK_TOKEN_RE)) {
    const token = match[1];
    if (token === undefined || seen.has(token)) continue;
    seen.add(token);
    ordered.push(token);
  }
  return ordered;
}
