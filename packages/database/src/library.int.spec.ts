// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).
import { LIBRARY_MANIFEST } from '@arch-canvas/library-content';
import { PGlite } from '@electric-sql/pglite';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from './migrate.js';
import * as schema from './schema.js';
import { seedGlobalLibrary } from './seed.js';

describe('diagram_elements_meta + libraries/library_items schema (T38, LIB-02)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });
  });

  afterAll(async () => {
    await client.close();
  });

  async function seedDiagram(slugSuffix: string) {
    const [user] = await db
      .insert(schema.users)
      .values({ email: `lib-${slugSuffix}@example.com`, displayName: `User ${slugSuffix}` })
      .returning();
    if (!user) throw new Error('user insert failed');

    const [org] = await db
      .insert(schema.organizations)
      .values({ name: `Org ${slugSuffix}`, slug: `org-lib-${slugSuffix}` })
      .returning();
    if (!org) throw new Error('organization insert failed');

    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ organizationId: org.id, name: `WS ${slugSuffix}`, slug: `ws-lib-${slugSuffix}` })
      .returning();
    if (!workspace) throw new Error('workspace insert failed');

    const [project] = await db
      .insert(schema.projects)
      .values({ workspaceId: workspace.id, name: `Project ${slugSuffix}`, ownerId: user.id })
      .returning();
    if (!project) throw new Error('project insert failed');

    const [diagram] = await db
      .insert(schema.diagrams)
      .values({ projectId: project.id, title: `Diagram ${slugSuffix}`, ownerId: user.id })
      .returning();
    if (!diagram) throw new Error('diagram insert failed');

    return { user, workspace, diagram };
  }

  it('applies the migration cleanly on top of the earlier migrations', async () => {
    const tables = await db.execute<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const names = tables.rows.map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining(['diagram_elements_meta', 'libraries', 'library_items']),
    );
  });

  it('diagram_elements_meta upserts idempotently by (diagram_id, element_id) — same element, single row', async () => {
    const { diagram } = await seedDiagram('meta-upsert');

    await db.insert(schema.diagramElementsMeta).values({
      diagramId: diagram.id,
      elementId: 'el-1',
      semanticType: 'aws.ec2',
      metadataJson: { note: 'first' },
      revision: 1,
    });

    // Second write for the SAME element — the composite PK forces this to be
    // an update-in-place (via onConflictDoUpdate at the route layer, T39),
    // never a second row. Here we assert the PK constraint itself: a bare
    // second INSERT with the same key is rejected as a duplicate.
    let caught: unknown;
    try {
      await db.insert(schema.diagramElementsMeta).values({
        diagramId: diagram.id,
        elementId: 'el-1',
        semanticType: 'aws.ec2',
        metadataJson: { note: 'second' },
        revision: 2,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const cause = (caught as { cause?: { code?: string } } | undefined)?.cause;
    expect(cause?.code).toBe('23505');

    // The idempotent path is an upsert, not a bare insert — proves the same
    // (diagram_id, element_id) key updates the existing row in place.
    await db
      .insert(schema.diagramElementsMeta)
      .values({
        diagramId: diagram.id,
        elementId: 'el-1',
        semanticType: 'aws.ec2',
        metadataJson: { note: 'upserted' },
        revision: 2,
      })
      .onConflictDoUpdate({
        target: [schema.diagramElementsMeta.diagramId, schema.diagramElementsMeta.elementId],
        set: { metadataJson: { note: 'upserted' }, revision: 2 },
      });

    const rows = await db
      .select()
      .from(schema.diagramElementsMeta)
      .where(
        and(
          eq(schema.diagramElementsMeta.diagramId, diagram.id),
          eq(schema.diagramElementsMeta.elementId, 'el-1'),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadataJson).toEqual({ note: 'upserted' });
    expect(rows[0]?.revision).toBe(2);
  });

  it('seedGlobalLibrary inserts every item of the T37 manifest as library_items of the global library', async () => {
    const { libraryId, itemCount } = await seedGlobalLibrary(db);
    expect(itemCount).toBe(LIBRARY_MANIFEST.items.length);

    const [library] = await db
      .select()
      .from(schema.libraries)
      .where(eq(schema.libraries.id, libraryId));
    expect(library).toMatchObject({
      workspaceId: null,
      name: LIBRARY_MANIFEST.name,
      version: LIBRARY_MANIFEST.version,
      enabled: true,
    });

    const items = await db
      .select()
      .from(schema.libraryItems)
      .where(eq(schema.libraryItems.libraryId, libraryId));
    expect(items).toHaveLength(LIBRARY_MANIFEST.items.length);

    const stableKeys = new Set(items.map((item) => item.stableKey));
    for (const manifestItem of LIBRARY_MANIFEST.items) {
      expect(stableKeys.has(manifestItem.stableKey)).toBe(true);
    }

    // Global library — workspace_id IS NULL (design.md "registra o manifesto de
    // T37 como a library global").
    const [globalRow] = await db
      .select()
      .from(schema.libraries)
      .where(and(isNull(schema.libraries.workspaceId), eq(schema.libraries.id, libraryId)));
    expect(globalRow).toBeDefined();
  });

  it('seedGlobalLibrary is idempotent — re-running does not duplicate the library or its items', async () => {
    const first = await seedGlobalLibrary(db);
    const second = await seedGlobalLibrary(db);
    expect(second.libraryId).toBe(first.libraryId);

    const libraryRows = await db
      .select()
      .from(schema.libraries)
      .where(eq(schema.libraries.id, first.libraryId));
    expect(libraryRows).toHaveLength(1);

    const itemRows = await db
      .select()
      .from(schema.libraryItems)
      .where(eq(schema.libraryItems.libraryId, first.libraryId));
    expect(itemRows).toHaveLength(LIBRARY_MANIFEST.items.length);
  });

  it('rejects a duplicate stable_key within the same library via the unique index', async () => {
    const [library] = await db
      .insert(schema.libraries)
      .values({
        workspaceId: null,
        name: 'dup-test-library',
        version: '1.0.0',
        license: 'CC0-1.0',
        manifestJson: {},
        enabled: true,
      })
      .returning();
    if (!library) throw new Error('library insert failed');

    await db.insert(schema.libraryItems).values({
      libraryId: library.id,
      stableKey: 'generic.compute.server',
      version: '1.0.0',
      sceneJson: {},
      metadataJson: {},
    });

    let caught: unknown;
    try {
      await db.insert(schema.libraryItems).values({
        libraryId: library.id,
        stableKey: 'generic.compute.server',
        version: '2.0.0',
        sceneJson: {},
        metadataJson: {},
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const cause = (caught as { cause?: { code?: string } } | undefined)?.cause;
    expect(cause?.code).toBe('23505');
  });
});
