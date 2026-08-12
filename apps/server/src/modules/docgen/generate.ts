import { specDocuments, withTx } from '@arch-canvas/database';
import { extractSceneSemantics, type SceneSemantics } from '@arch-canvas/diagram-domain';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../auth/db.js';
import { listElementMetadata } from '../library/metadata.js';
import { materializeScene } from '../snapshot/scene.js';
import { EXPORT_BUCKET, type StorageClient } from '../storage/index.js';
import { assembleMarkdown, buildAllSections } from './sections.js';

export interface SpecDocumentRow {
  id: string;
  diagramId: string;
  sourceRevision: number;
  version: number;
  markdownKey: string;
  status: 'draft' | 'current' | 'superseded';
  generatedBy: string;
  createdAt: Date;
}

export function markdownObjectKey(diagramId: string, version: number): string {
  return `diagrams/${diagramId}/specs/${version}.md`;
}

/** Highest existing `version` for `diagramId`, or 0 when none exists yet — next insert uses `+1`. Exported for `regenerateSection.ts` (T63) to reuse unchanged. */
export async function latestSpecVersion(db: Db, diagramId: string): Promise<number> {
  const [row] = await db
    .select({ version: specDocuments.version })
    .from(specDocuments)
    .where(eq(specDocuments.diagramId, diagramId))
    .orderBy(desc(specDocuments.version))
    .limit(1);
  return row?.version ?? 0;
}

/**
 * Loads everything `extractSceneSemantics` needs to describe a diagram's
 * current state: the materialized scene (F1c's op-log fold) and every
 * `diagram_elements_meta` row, merged into the `{ elementId, semantics }`
 * shape the pure T58 extractor accepts. `semantics` combines `semanticType`
 * with the free-form `metadataJson` (so a `decision`/`environment`/`protocol`
 * field set via the library metadata route is visible to docgen/lint alike).
 * Exported for `regenerateSection.ts` (T63) to reuse unchanged.
 */
export async function loadSceneSemantics(
  db: Db,
  diagramId: string,
): Promise<{ revision: number; semantics: SceneSemantics }> {
  const [{ scene, revision }, metaRows] = await Promise.all([
    materializeScene(db, diagramId),
    listElementMetadata(db, diagramId),
  ]);

  const metadataInputs = metaRows.map((row) => ({
    elementId: row.elementId,
    semantics: {
      ...(row.semanticType !== null ? { semanticType: row.semanticType } : {}),
      ...(typeof row.metadataJson === 'object' && row.metadataJson !== null
        ? row.metadataJson
        : {}),
    },
  }));

  return { revision, semantics: extractSceneSemantics(scene, metadataInputs) };
}

export interface InsertNewSpecVersionInput {
  diagramId: string;
  sourceRevision: number;
  markdown: string;
  generatedBy: string;
}

/**
 * Shared write path for BOTH a full generation (T62) and a single-section
 * regeneration (T63): stores the Markdown under a fresh version's object
 * key, then — in one transaction — flips the diagram's prior `'current'` row
 * to `'superseded'` and inserts the new `'current'` row. Never a PATCH in
 * place; the previous version's storage object is never touched, same
 * immutable-version discipline as `diagram_snapshots`.
 */
export async function insertNewSpecVersion(
  db: Db,
  storage: StorageClient,
  input: InsertNewSpecVersionInput,
): Promise<SpecDocumentRow> {
  const version = (await latestSpecVersion(db, input.diagramId)) + 1;
  const markdownKey = markdownObjectKey(input.diagramId, version);
  await storage.putObject(EXPORT_BUCKET, markdownKey, input.markdown, 'text/markdown');

  return withTx(db, async (tx) => {
    await tx
      .update(specDocuments)
      .set({ status: 'superseded' })
      .where(
        and(eq(specDocuments.diagramId, input.diagramId), eq(specDocuments.status, 'current')),
      );

    const [row] = await tx
      .insert(specDocuments)
      .values({
        diagramId: input.diagramId,
        sourceRevision: input.sourceRevision,
        version,
        markdownKey,
        status: 'current',
        generatedBy: input.generatedBy,
      })
      .returning();
    if (!row) throw new Error('failed to insert spec_documents row');
    return row;
  });
}

export interface GenerateSpecInput {
  diagramId: string;
  diagramTitle: string;
  diagramDescription: string | null;
  generatedBy: string;
}

/**
 * DOC-01/02: generates a fresh structured Markdown spec from the diagram's
 * CURRENT state and writes it as a new `spec_documents` version via
 * `insertNewSpecVersion`.
 */
export async function generateSpecDocument(
  db: Db,
  storage: StorageClient,
  input: GenerateSpecInput,
): Promise<SpecDocumentRow> {
  const { revision, semantics } = await loadSceneSemantics(db, input.diagramId);
  const sections = buildAllSections(input.diagramTitle, input.diagramDescription, semantics);
  const markdown = assembleMarkdown(input.diagramTitle, sections);

  return insertNewSpecVersion(db, storage, {
    diagramId: input.diagramId,
    sourceRevision: revision,
    markdown,
    generatedBy: input.generatedBy,
  });
}

export async function listSpecDocuments(
  db: Db,
  diagramId: string,
  options: { cursor?: number; limit?: number } = {},
): Promise<{ specs: SpecDocumentRow[]; nextCursor: number | null }> {
  const limit = options.limit ?? 20;
  const cursor = options.cursor;
  const rows = await db
    .select()
    .from(specDocuments)
    .where(eq(specDocuments.diagramId, diagramId))
    .orderBy(desc(specDocuments.version));

  const filtered = cursor === undefined ? rows : rows.filter((row) => row.version < cursor);
  const page = filtered.slice(0, limit);
  const nextCursor = filtered.length > limit ? (page[page.length - 1]?.version ?? null) : null;
  return { specs: page, nextCursor };
}

export async function getSpecDocument(
  db: Db,
  diagramId: string,
  version: number,
): Promise<SpecDocumentRow | null> {
  const [row] = await db
    .select()
    .from(specDocuments)
    .where(and(eq(specDocuments.diagramId, diagramId), eq(specDocuments.version, version)));
  return row ?? null;
}
