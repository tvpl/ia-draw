// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. Same pattern as migrate.int.spec.ts (AD-007).
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from './migrate.js';
import * as schema from './schema.js';

/** T59 — spec_documents, comments, presentations, presentation_frames (DOC-02, PRS-01/02/03, CMT-01). */
describe('database schema: spec_documents/comments/presentations/presentation_frames (T59)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;

  let userId: string;
  let diagramId: string;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const [user] = await db
      .insert(schema.users)
      .values({ email: 'author@example.com', displayName: 'Author' })
      .returning();
    if (!user) throw new Error('user insert failed');
    userId = user.id;

    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Acme', slug: 'acme-collab' })
      .returning();
    if (!org) throw new Error('organization insert failed');

    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ organizationId: org.id, name: 'Platform', slug: 'platform-collab' })
      .returning();
    if (!workspace) throw new Error('workspace insert failed');

    const [project] = await db
      .insert(schema.projects)
      .values({ workspaceId: workspace.id, name: 'Core', ownerId: user.id })
      .returning();
    if (!project) throw new Error('project insert failed');

    const [diagram] = await db
      .insert(schema.diagrams)
      .values({ projectId: project.id, title: 'System Overview', ownerId: user.id })
      .returning();
    if (!diagram) throw new Error('diagram insert failed');
    diagramId = diagram.id;
  });

  afterAll(async () => {
    await client.close();
  });

  it('applies the migration from scratch (beforeAll already ran it without throwing)', () => {
    expect(diagramId).toBeDefined();
  });

  it('inserts one row per table with valid FKs', async () => {
    const [specDoc] = await db
      .insert(schema.specDocuments)
      .values({
        diagramId,
        sourceRevision: 0,
        version: 1,
        markdownKey: 'specs/diagram/v1.md',
        status: 'current',
        generatedBy: userId,
      })
      .returning();
    expect(specDoc).toMatchObject({ diagramId, version: 1, status: 'current' });

    const [comment] = await db
      .insert(schema.comments)
      .values({
        diagramId,
        elementId: 'rect-a',
        body: 'Should this be async?',
        authorId: userId,
      })
      .returning();
    expect(comment).toMatchObject({ diagramId, elementId: 'rect-a', status: 'open' });
    if (!comment) throw new Error('comment insert failed');

    const [presentation] = await db
      .insert(schema.presentations)
      .values({ diagramId, name: 'Exec walkthrough' })
      .returning();
    expect(presentation).toMatchObject({ diagramId, name: 'Exec walkthrough' });
    if (!presentation) throw new Error('presentation insert failed');

    const [frame] = await db
      .insert(schema.presentationFrames)
      .values({
        presentationId: presentation.id,
        elementId: 'frame-1',
        position: 0,
        navLinksJson: [],
      })
      .returning();
    expect(frame).toMatchObject({ presentationId: presentation.id, position: 0 });
  });

  it('inserts a comment with parent_id pointing to another comment (thread)', async () => {
    const [root] = await db
      .insert(schema.comments)
      .values({ diagramId, body: 'Root comment', authorId: userId })
      .returning();
    if (!root) throw new Error('root comment insert failed');

    const [reply] = await db
      .insert(schema.comments)
      .values({ diagramId, body: 'Reply', authorId: userId, parentId: root.id })
      .returning();
    expect(reply?.parentId).toBe(root.id);

    const found = await db.query.comments.findFirst({
      where: eq(schema.comments.id, reply?.id ?? ''),
    });
    expect(found?.parentId).toBe(root.id);
  });

  it('rejects a duplicate (diagram_id, version) in spec_documents via the unique index', async () => {
    await db.insert(schema.specDocuments).values({
      diagramId,
      sourceRevision: 0,
      version: 100,
      markdownKey: 'specs/diagram/v100-a.md',
      status: 'draft',
      generatedBy: userId,
    });

    let caught: unknown;
    try {
      await db.insert(schema.specDocuments).values({
        diagramId,
        sourceRevision: 0,
        version: 100,
        markdownKey: 'specs/diagram/v100-b.md',
        status: 'draft',
        generatedBy: userId,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const cause = (caught as { cause?: { code?: string } }).cause;
    expect(cause?.code).toBe('23505');
  });
});
