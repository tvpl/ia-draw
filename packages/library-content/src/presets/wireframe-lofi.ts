import type { LibraryItem } from '../schema.js';

/**
 * T67 (PRS-04) — low-fi wireframe kit: screens, buttons, inputs and lists
 * for navigable-prototype presentations (F3). Deliberately low-fidelity per
 * the task's own instruction ("sem cor/estilo de alta fidelidade — traços
 * cinza, cantos retos"): a single flat gray stroke color, no rounded
 * corners, no AWS-style detail. Original, project-authored artwork (same
 * CC0-1.0 dedication as `GENERIC_ITEMS` in `manifest.ts` — plain geometric
 * shapes, no third-party design system's glyph is copied).
 *
 * Every item resolves by `stableKey` through the exact same generic path
 * `compile()` (diagram-ir/F2b) and `search_library` (ai-tools/F2c) already
 * use for every other library item — no new mechanism, no code change in
 * either package, per the task's explicit instruction.
 */
const WIREFRAME_LICENSE = 'CC0-1.0';
const WIREFRAME_ATTRIBUTION = 'Architecture Canvas project (original artwork, no external source)';
const WIREFRAME_COLOR = '#6B7280'; // flat low-fi gray — no hi-fi brand color

function inline(svg: string): LibraryItem['icon'] {
  return { kind: 'inline', svg };
}

export const WIREFRAME_LOFI_ITEMS: LibraryItem[] = [
  {
    stableKey: 'wireframe.screen.blank',
    name: 'Screen',
    category: 'wireframe',
    aliases: ['frame', 'page', 'view'],
    description: 'Blank low-fi screen/frame container for a navigable prototype.',
    tags: ['wireframe', 'prototype', 'screen'],
    color: WIREFRAME_COLOR,
    icon: inline(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="20" height="20" fill="none" stroke-width="1.5"/><line x1="2" y1="6" x2="22" y2="6" stroke-width="1.5"/><circle cx="4.5" cy="4" r="0.6"/></svg>',
    ),
    version: '1.0.0',
    license: WIREFRAME_LICENSE,
    attribution: WIREFRAME_ATTRIBUTION,
  },
  {
    stableKey: 'wireframe.button.primary',
    name: 'Button',
    category: 'wireframe',
    aliases: ['cta', 'action button'],
    description: 'Low-fi rectangular button placeholder (straight corners, no hi-fi styling).',
    tags: ['wireframe', 'prototype', 'button'],
    color: WIREFRAME_COLOR,
    icon: inline(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="8" width="20" height="8" fill="none" stroke-width="1.5"/><line x1="6" y1="12" x2="18" y2="12" stroke-width="1.5"/></svg>',
    ),
    version: '1.0.0',
    license: WIREFRAME_LICENSE,
    attribution: WIREFRAME_ATTRIBUTION,
  },
  {
    stableKey: 'wireframe.input.text',
    name: 'Text input',
    category: 'wireframe',
    aliases: ['textbox', 'form field'],
    description: 'Low-fi single-line text input placeholder.',
    tags: ['wireframe', 'prototype', 'input', 'form'],
    color: WIREFRAME_COLOR,
    icon: inline(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="9" width="20" height="6" fill="none" stroke-width="1.5"/><line x1="4" y1="12" x2="4" y2="12" stroke-width="1.5"/></svg>',
    ),
    version: '1.0.0',
    license: WIREFRAME_LICENSE,
    attribution: WIREFRAME_ATTRIBUTION,
  },
  {
    stableKey: 'wireframe.list.item',
    name: 'List',
    category: 'wireframe',
    aliases: ['list item', 'row', 'table row'],
    description: 'Low-fi list of rows placeholder (each row a plain rule).',
    tags: ['wireframe', 'prototype', 'list'],
    color: WIREFRAME_COLOR,
    icon: inline(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="20" height="20" fill="none" stroke-width="1.5"/><line x1="4" y1="7" x2="20" y2="7" stroke-width="1.5"/><line x1="4" y1="12" x2="20" y2="12" stroke-width="1.5"/><line x1="4" y1="17" x2="20" y2="17" stroke-width="1.5"/></svg>',
    ),
    version: '1.0.0',
    license: WIREFRAME_LICENSE,
    attribution: WIREFRAME_ATTRIBUTION,
  },
];
