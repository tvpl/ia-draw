import type { SceneSemantics } from '@arch-canvas/diagram-domain';
import { describe, expect, it } from 'vitest';
import { assembleMarkdown, buildAllSections, NOT_SPECIFIED, OPEN_QUESTION } from './sections.js';

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

describe('docgen sections — DOC-01 (cites real elementIds across distinct sections)', () => {
  it('the components and flows sections both cite the 3 real elementIds', () => {
    const sections = buildAllSections(
      'Checkout System',
      'A checkout flow',
      THREE_COMPONENTS_TWO_EDGES,
    );
    for (const id of ['api', 'db', 'ui']) {
      expect(sections.components).toContain(id);
    }
    // Flows section cites elementIds via the edge endpoints (from/to).
    expect(sections.flows).toContain('ui');
    expect(sections.flows).toContain('api');
    expect(sections.flows).toContain('db');
  });
});

describe('docgen sections — DOC-03 (never invents, literal placeholders)', () => {
  it('a component with no semantic metadata gets the literal NOT_SPECIFIED placeholder, never an invented value', () => {
    const sections = buildAllSections('X', null, THREE_COMPONENTS_TWO_EDGES);
    // 'db' has no semantics — its line must carry the literal placeholder.
    const dbLine = sections.components.split('\n').find((line) => line.includes('`db`'));
    expect(dbLine).toContain(NOT_SPECIFIED);
  });

  it('decisions section is the literal OPEN_QUESTION placeholder when no element carries a decision', () => {
    const sections = buildAllSections('X', null, THREE_COMPONENTS_TWO_EDGES);
    expect(sections.decisions).toBe(OPEN_QUESTION);
  });

  it('decisions section cites a real elementId when metadata carries an explicit decision string', () => {
    const withDecision: SceneSemantics = {
      elements: [
        {
          elementId: 'api',
          type: 'rectangle',
          label: 'API',
          semantics: { decision: 'Use REST over gRPC' },
        },
      ],
      edges: [],
    };
    const sections = buildAllSections('X', null, withDecision);
    expect(sections.decisions).toContain('api');
    expect(sections.decisions).toContain('Use REST over gRPC');
  });

  it('a null diagram description surfaces literally as NOT_SPECIFIED in the overview section', () => {
    const sections = buildAllSections('X', null, THREE_COMPONENTS_TWO_EDGES);
    expect(sections.overview).toContain(NOT_SPECIFIED);
  });
});

describe('docgen sections — assembleMarkdown is deterministic', () => {
  it('assembling the same sections twice produces byte-identical Markdown', () => {
    const sections = buildAllSections('Checkout System', 'desc', THREE_COMPONENTS_TWO_EDGES);
    expect(assembleMarkdown('Checkout System', sections)).toBe(
      assembleMarkdown('Checkout System', sections),
    );
  });

  it('an empty-scene document still assembles without throwing', () => {
    const empty: SceneSemantics = { elements: [], edges: [] };
    const sections = buildAllSections('Empty', null, empty);
    expect(() => assembleMarkdown('Empty', sections)).not.toThrow();
  });
});
