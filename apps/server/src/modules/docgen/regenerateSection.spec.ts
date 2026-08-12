import type { SceneSemantics } from '@arch-canvas/diagram-domain';
import { describe, expect, it } from 'vitest';
import { buildSection, parseMarkdownSections } from './regenerateSection.js';
import { assembleMarkdown, buildAllSections, SECTION_NAMES } from './sections.js';

const THREE_COMPONENTS_TWO_EDGES: SceneSemantics = {
  elements: [
    {
      elementId: 'api',
      type: 'rectangle',
      label: 'API Gateway',
      semantics: { semanticType: 'service' },
    },
    { elementId: 'db', type: 'rectangle', label: 'Postgres', semantics: undefined },
    {
      elementId: 'ui',
      type: 'rectangle',
      label: 'Web UI',
      semantics: { semanticType: 'frontend' },
    },
  ],
  edges: [
    { from: 'ui', to: 'api', label: 'HTTPS' },
    { from: 'api', to: 'db', label: 'SQL' },
  ],
};

describe('regenerateSection — assemble/parse round-trip (T63 foundation)', () => {
  it('parseMarkdownSections recovers byte-identical section text for every section after assembleMarkdown', () => {
    const sections = buildAllSections('Checkout System', 'desc', THREE_COMPONENTS_TWO_EDGES);
    const markdown = assembleMarkdown('Checkout System', sections);
    const parsed = parseMarkdownSections(markdown);

    for (const name of SECTION_NAMES) {
      expect(parsed[name]).toBe(sections[name]);
    }
  });

  it('buildSection for a single section name matches the corresponding entry from buildAllSections', () => {
    const sections = buildAllSections('X', null, THREE_COMPONENTS_TWO_EDGES);
    for (const name of SECTION_NAMES) {
      expect(buildSection(name, 'X', null, THREE_COMPONENTS_TWO_EDGES)).toBe(sections[name]);
    }
  });

  it('an empty-scene document still parses back to empty (never throws)', () => {
    const empty: SceneSemantics = { elements: [], edges: [] };
    const sections = buildAllSections('Empty', null, empty);
    const markdown = assembleMarkdown('Empty', sections);
    const parsed = parseMarkdownSections(markdown);
    expect(parsed.components).toBe(sections.components);
    expect(parsed.flows).toBe(sections.flows);
  });

  it('recomputing one section and splicing it back leaves the other three byte-identical', () => {
    const baseSections = buildAllSections('X', 'd', THREE_COMPONENTS_TWO_EDGES);
    const baseMarkdown = assembleMarkdown('X', baseSections);
    const parsed = parseMarkdownSections(baseMarkdown);

    // Simulate a scene change that only affects "flows".
    const changedScene: SceneSemantics = {
      ...THREE_COMPONENTS_TWO_EDGES,
      edges: [{ from: 'ui', to: 'db', label: 'new edge' }],
    };
    const freshFlows = buildSection('flows', 'X', 'd', changedScene);
    const newSections = { ...parsed, flows: freshFlows };
    const newMarkdown = assembleMarkdown('X', newSections);
    const reparsed = parseMarkdownSections(newMarkdown);

    expect(reparsed.overview).toBe(parsed.overview);
    expect(reparsed.components).toBe(parsed.components);
    expect(reparsed.decisions).toBe(parsed.decisions);
    expect(reparsed.flows).not.toBe(parsed.flows);
  });
});
