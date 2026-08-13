import { specDocuments } from '@arch-canvas/database';
import type { SceneSemantics } from '@arch-canvas/diagram-domain';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../auth/db.js';
import { EXPORT_BUCKET, type StorageClient } from '../storage/index.js';
import { insertNewSpecVersion, loadSceneSemantics, type SpecDocumentRow } from './generate.js';
import {
  assembleMarkdown,
  buildComponentsSection,
  buildDecisionsSection,
  buildFlowsSection,
  buildOverviewSection,
  SECTION_NAMES,
  type SectionName,
  sectionHeading,
} from './sections.js';

export class SpecDocumentNotFoundError extends Error {
  statusCode = 404;
  constructor(diagramId: string, version: number) {
    super(`spec_documents version ${version} not found for diagram ${diagramId}`);
  }
}

export function isSectionName(value: string): value is SectionName {
  return (SECTION_NAMES as readonly string[]).includes(value);
}

/**
 * Recomputes exactly ONE section's content — reuses the same per-section
 * generators `generate.ts`'s `buildAllSections` calls (T62's "Reuses" note:
 * "extraia a função de seção individual de T62 para reuso, não duplique"),
 * never a separate implementation of any section's Markdown.
 */
export function buildSection(
  section: SectionName,
  diagramTitle: string,
  description: string | null,
  semantics: SceneSemantics,
): string {
  switch (section) {
    case 'overview':
      return buildOverviewSection(diagramTitle, description, semantics);
    case 'components':
      return buildComponentsSection(semantics);
    case 'flows':
      return buildFlowsSection(semantics);
    case 'decisions':
      return buildDecisionsSection(semantics);
    default: {
      const exhaustive: never = section;
      throw new Error(`unknown section: ${exhaustive}`);
    }
  }
}

/**
 * Inverse of `assembleMarkdown` — splits a previously assembled document back
 * into its per-section text. Regenerating one section must leave the other
 * three byte-identical, which requires recovering their exact prior text
 * rather than recomputing them. Only ever fed Markdown `assembleMarkdown`
 * itself produced (T62), so the fixed heading set is a safe split key.
 */
export function parseMarkdownSections(markdown: string): Record<SectionName, string> {
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

export interface RegenerateSectionInput {
  diagramId: string;
  diagramTitle: string;
  diagramDescription: string | null;
  baseVersion: number;
  section: SectionName;
  generatedBy: string;
}

/**
 * DOC-04: recomputes exactly one section against the diagram's CURRENT state
 * and writes a brand-new `spec_documents` version whose Markdown is
 * byte-identical to `baseVersion`'s except for the regenerated section. The
 * previous version's storage object is never overwritten — `insertNewSpecVersion`
 * (T62) always writes to a fresh object key under a fresh row.
 */
export async function regenerateSpecSection(
  db: Db,
  storage: StorageClient,
  input: RegenerateSectionInput,
): Promise<SpecDocumentRow> {
  const [baseRow] = await db
    .select()
    .from(specDocuments)
    .where(
      and(
        eq(specDocuments.diagramId, input.diagramId),
        eq(specDocuments.version, input.baseVersion),
      ),
    );
  if (!baseRow) throw new SpecDocumentNotFoundError(input.diagramId, input.baseVersion);

  const baseMarkdown = (await storage.getObject(EXPORT_BUCKET, baseRow.markdownKey)).toString(
    'utf8',
  );
  const baseSections = parseMarkdownSections(baseMarkdown);

  const { revision, semantics } = await loadSceneSemantics(db, input.diagramId);
  const freshSectionText = buildSection(
    input.section,
    input.diagramTitle,
    input.diagramDescription,
    semantics,
  );

  const newSections = { ...baseSections, [input.section]: freshSectionText };
  const markdown = assembleMarkdown(input.diagramTitle, newSections);

  return insertNewSpecVersion(db, storage, {
    diagramId: input.diagramId,
    sourceRevision: revision,
    markdown,
    generatedBy: input.generatedBy,
  });
}
