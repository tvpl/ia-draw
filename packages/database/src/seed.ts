import { LIBRARY_MANIFEST, type LibraryManifest } from '@arch-canvas/library-content';
import { and, eq, isNull } from 'drizzle-orm';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import type * as schema from './schema.js';
import { libraries, libraryItems } from './schema.js';

type Schema = typeof schema;
type Db<TQueryResult extends PgQueryResultHKT> =
  | PgDatabase<TQueryResult, Schema>
  | PgTransaction<TQueryResult, Schema, ExtractTablesWithRelations<Schema>>;

export interface SeedGlobalLibraryResult {
  libraryId: string;
  itemCount: number;
}

/**
 * Registers `manifest` (defaults to `library-content`'s T37 manifest) as the
 * global library — `workspace_id IS NULL` (LIB-02/T38). Idempotent: re-running
 * against an already-seeded database updates the existing global library and
 * its items in place (matched by `stable_key`) instead of duplicating rows,
 * so this is safe to call from a startup/migration hook repeatedly.
 */
export async function seedGlobalLibrary<TQueryResult extends PgQueryResultHKT>(
  db: Db<TQueryResult>,
  manifest: LibraryManifest = LIBRARY_MANIFEST,
): Promise<SeedGlobalLibraryResult> {
  const [existing] = await db
    .select({ id: libraries.id })
    .from(libraries)
    .where(and(isNull(libraries.workspaceId), eq(libraries.name, manifest.name)));

  let libraryId: string;
  if (existing) {
    libraryId = existing.id;
    await db
      .update(libraries)
      .set({ version: manifest.version, manifestJson: manifest, updatedAt: new Date() })
      .where(eq(libraries.id, libraryId));
  } else {
    const [inserted] = await db
      .insert(libraries)
      .values({
        workspaceId: null,
        name: manifest.name,
        version: manifest.version,
        // Each item carries its own verified license/attribution
        // (packages/library-content) — this aggregate field documents that
        // the library as a whole is multi-licensed rather than claiming one.
        license: 'multiple — see each library_item.metadata_json.license',
        manifestJson: manifest,
        enabled: true,
      })
      .returning({ id: libraries.id });
    if (!inserted) throw new Error('seedGlobalLibrary: failed to insert the global library row');
    libraryId = inserted.id;
  }

  for (const item of manifest.items) {
    await db
      .insert(libraryItems)
      .values({
        libraryId,
        stableKey: item.stableKey,
        version: item.version,
        sceneJson: {},
        metadataJson: item,
        iconKey: item.stableKey,
      })
      .onConflictDoUpdate({
        target: [libraryItems.libraryId, libraryItems.stableKey],
        set: {
          version: item.version,
          metadataJson: item,
          iconKey: item.stableKey,
          updatedAt: new Date(),
        },
      });
  }

  return { libraryId, itemCount: manifest.items.length };
}
