import type { SceneSemantics } from '@arch-canvas/diagram-domain';

/**
 * Pure Markdown template logic for the docgen module (T62, DOC-01/03). No
 * I/O, no DB, no storage client — only string transforms over an already
 * extracted `SceneSemantics`. Each section builder (`buildOverviewSection`,
 * etc.) is exported individually, not just through `buildAllSections`, so
 * `regenerateSection.ts` (T63) can recompute exactly one of them without
 * duplicating this logic (task's "Reuses" note).
 */

/** DOC-03: literal placeholders — never an invented protocol/SLA/decision. */
export const NOT_SPECIFIED = 'não especificado';
export const OPEN_QUESTION = 'pergunta aberta';

export const SECTION_NAMES = ['overview', 'components', 'flows', 'decisions'] as const;
export type SectionName = (typeof SECTION_NAMES)[number];

export const SECTION_TITLES: Record<SectionName, string> = {
  overview: 'Visão Geral',
  components: 'Componentes',
  flows: 'Fluxos',
  decisions: 'Decisões',
};

/** `## <Title>` heading text for a section — exported so `regenerateSection.ts` (T63) can locate the same headings when splitting a previously assembled document back apart, without duplicating the `SECTION_TITLES` lookup. */
export function sectionHeading(name: SectionName): string {
  return `## ${SECTION_TITLES[name]}`;
}

export function buildOverviewSection(
  diagramTitle: string,
  description: string | null,
  semantics: SceneSemantics,
): string {
  const componentCount = semantics.elements.filter((el) => el.type !== 'text').length;
  const flowCount = semantics.edges.length;
  return [
    `Este documento descreve o diagrama **${diagramTitle}**.`,
    '',
    `- Descrição: ${description ?? NOT_SPECIFIED}`,
    `- Componentes mapeados: ${componentCount}`,
    `- Fluxos mapeados: ${flowCount}`,
  ].join('\n');
}

export function buildComponentsSection(semantics: SceneSemantics): string {
  const components = semantics.elements.filter((el) => el.type !== 'text');
  if (components.length === 0) return 'Nenhum componente encontrado no canvas.';

  return components
    .map((el) => {
      const label = el.label ?? NOT_SPECIFIED;
      const semanticType =
        typeof el.semantics?.semanticType === 'string' ? el.semantics.semanticType : NOT_SPECIFIED;
      return `- **${label}** (\`${el.elementId}\`, tipo: ${el.type}) — tipo semântico: ${semanticType}`;
    })
    .join('\n');
}

export function buildFlowsSection(semantics: SceneSemantics): string {
  if (semantics.edges.length === 0) return 'Nenhum fluxo mapeado.';

  return semantics.edges
    .map((edge) => `- \`${edge.from}\` → \`${edge.to}\`: ${edge.label ?? NOT_SPECIFIED}`)
    .join('\n');
}

/**
 * DOC-03: the canvas/metadata model has no dedicated "architecture decision"
 * concept — this never invents one. A decision is only ever surfaced when an
 * element's own metadata carries an explicit `decision` string (set by a
 * human via the library metadata routes, F2a); everything else is the
 * literal `OPEN_QUESTION` placeholder.
 */
export function buildDecisionsSection(semantics: SceneSemantics): string {
  const decisions = semantics.elements
    .map((el) => ({ el, decision: el.semantics?.decision }))
    .filter(
      (entry): entry is typeof entry & { decision: string } => typeof entry.decision === 'string',
    );
  if (decisions.length === 0) return OPEN_QUESTION;

  return decisions
    .map(
      ({ el, decision }) => `- **${el.label ?? NOT_SPECIFIED}** (\`${el.elementId}\`): ${decision}`,
    )
    .join('\n');
}

export function buildAllSections(
  diagramTitle: string,
  description: string | null,
  semantics: SceneSemantics,
): Record<SectionName, string> {
  return {
    overview: buildOverviewSection(diagramTitle, description, semantics),
    components: buildComponentsSection(semantics),
    flows: buildFlowsSection(semantics),
    decisions: buildDecisionsSection(semantics),
  };
}

/** Deterministically assembles the full Markdown document from its sections, in fixed `SECTION_NAMES` order. */
export function assembleMarkdown(
  diagramTitle: string,
  sections: Record<SectionName, string>,
): string {
  const parts = [`# ${diagramTitle}`];
  for (const name of SECTION_NAMES) {
    parts.push('', sectionHeading(name), '', sections[name]);
  }
  return `${parts.join('\n')}\n`;
}
