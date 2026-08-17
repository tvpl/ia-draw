import { describe, expect, it } from 'vitest';
import { extractReferencedElementIds, parseSpecSections } from './parseSpecMarkdown.js';

/** Same shape `assembleMarkdown` (server `sections.ts`) always produces. */
function buildDocument(sections: {
  overview: string;
  components: string;
  flows: string;
  decisions: string;
}): string {
  return [
    '# Diagram Title',
    '',
    '## Visão Geral',
    '',
    sections.overview,
    '',
    '## Componentes',
    '',
    sections.components,
    '',
    '## Fluxos',
    '',
    sections.flows,
    '',
    '## Decisões',
    '',
    sections.decisions,
    '',
  ].join('\n');
}

describe('parseSpecSections (T3, LDC-13)', () => {
  it('splits a normal 4-section document into its 4 named sections', () => {
    const markdown = buildDocument({
      overview: 'Este documento descreve o diagrama.',
      components: '- **API** (`api`, tipo: rectangle) — tipo semântico: service',
      flows: '- `ui` → `api`: chama',
      decisions: 'pergunta aberta',
    });

    const sections = parseSpecSections(markdown);

    expect(sections.overview).toBe('Este documento descreve o diagrama.');
    expect(sections.components).toBe(
      '- **API** (`api`, tipo: rectangle) — tipo semântico: service',
    );
    expect(sections.flows).toBe('- `ui` → `api`: chama');
    expect(sections.decisions).toBe('pergunta aberta');
  });

  it('a document missing one heading yields an empty string for that section, never throws', () => {
    const markdown = [
      '# Diagram Title',
      '',
      '## Visão Geral',
      '',
      'overview body',
      '',
      '## Fluxos',
      '',
      'flows body',
      '',
      '## Decisões',
      '',
      'decisions body',
      '',
    ].join('\n');

    expect(() => parseSpecSections(markdown)).not.toThrow();
    const sections = parseSpecSections(markdown);
    expect(sections.components).toBe('');
    expect(sections.overview).toBe('overview body');
    expect(sections.flows).toBe('flows body');
    expect(sections.decisions).toBe('decisions body');
  });

  it('a completely empty/malformed document yields empty strings for every section, never throws', () => {
    expect(() => parseSpecSections('not a docgen document at all')).not.toThrow();
    const sections = parseSpecSections('not a docgen document at all');
    expect(sections).toEqual({ overview: '', components: '', flows: '', decisions: '' });
  });
});

describe('extractReferencedElementIds (T3, LDC-14/15/17)', () => {
  it('LDC-14/15: returns every distinct backtick token, in first-appearance order, no duplicates', () => {
    const body = [
      '- **API** (`api`, tipo: rectangle) — tipo semântico: service',
      '- **DB** (`db`, tipo: rectangle) — tipo semântico: database',
      '- `ui` → `api`: chama',
      '- `api` → `db`: lê',
    ].join('\n');

    expect(extractReferencedElementIds(body)).toEqual(['api', 'db', 'ui']);
  });

  it('a section with zero backtick tokens (placeholder body) returns an empty array', () => {
    expect(extractReferencedElementIds('não especificado')).toEqual([]);
    expect(extractReferencedElementIds('pergunta aberta')).toEqual([]);
  });

  it('LDC-17: an overview body (never contains backticks) returns an empty array by construction', () => {
    const overviewBody = [
      'Este documento descreve o diagrama **Sistema**.',
      '',
      '- Descrição: não especificado',
      '- Componentes mapeados: 3',
      '- Fluxos mapeados: 1',
    ].join('\n');

    expect(extractReferencedElementIds(overviewBody)).toEqual([]);
  });
});
