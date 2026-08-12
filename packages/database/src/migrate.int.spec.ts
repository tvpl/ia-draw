// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services.
import { PGlite } from '@electric-sql/pglite';
import { eq, isNull } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from './migrate.js';
import * as schema from './schema.js';
import { withTx } from './tx.js';

describe('database schema + migration (docs/product-spec.md §6, design.md Data Models)', () => {
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

  it('applies the migration and inserts/queries one row per table, respecting FKs', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'owner@example.com', displayName: 'Owner' })
      .returning();
    expect(user?.id).toBeDefined();
    if (!user) throw new Error('user insert failed');

    const [session] = await db
      .insert(schema.sessions)
      .values({
        userId: user.id,
        tokenHash: 'hash-1',
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    expect(session?.userId).toBe(user.id);

    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Acme', slug: 'acme' })
      .returning();
    if (!org) throw new Error('organization insert failed');

    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ organizationId: org.id, name: 'Platform', slug: 'platform' })
      .returning();
    if (!workspace) throw new Error('workspace insert failed');

    const [member] = await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId: workspace.id, userId: user.id, role: 'org_admin' })
      .returning();
    expect(member?.role).toBe('org_admin');

    const [project] = await db
      .insert(schema.projects)
      .values({ workspaceId: workspace.id, name: 'Core', ownerId: user.id })
      .returning();
    if (!project) throw new Error('project insert failed');

    const [diagram] = await db
      .insert(schema.diagrams)
      .values({ projectId: project.id, title: 'System Overview', ownerId: user.id })
      .returning();

    expect(diagram).toMatchObject({
      title: 'System Overview',
      status: 'draft',
      currentRevision: 0,
      schemaVersion: 'v1',
      projectId: project.id,
      ownerId: user.id,
    });
    if (!diagram) throw new Error('diagram insert failed');

    const foundDiagram = await db.query.diagrams.findFirst({
      where: eq(schema.diagrams.id, diagram.id),
    });
    expect(foundDiagram?.title).toBe('System Overview');
  });

  it('rejects an FK violation when inserting a workspace for a non-existent organization', async () => {
    const missingOrgId = '00000000-0000-0000-0000-000000000000';
    await expect(
      db.insert(schema.workspaces).values({
        organizationId: missingOrgId,
        name: 'Orphan',
        slug: 'orphan-workspace',
      }),
    ).rejects.toThrow();
  });

  it('rejects a duplicate workspace slug via the unique constraint', async () => {
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Globex', slug: 'globex' })
      .returning();
    if (!org) throw new Error('organization insert failed');

    await db.insert(schema.workspaces).values({
      organizationId: org.id,
      name: 'First',
      slug: 'duplicate-slug',
    });

    let caught: unknown;
    try {
      await db.insert(schema.workspaces).values({
        organizationId: org.id,
        name: 'Second',
        slug: 'duplicate-slug',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const cause = (caught as { cause?: { code?: string } }).cause;
    // Postgres error code 23505 = unique_violation — proves the slug UNIQUE index is enforced,
    // not just that the insert failed for some other reason.
    expect(cause?.code).toBe('23505');

    const rowsWithSlug = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.slug, 'duplicate-slug'));
    expect(rowsWithSlug).toHaveLength(1);
    expect(rowsWithSlug[0]?.name).toBe('First');
  });

  it('filters soft-deleted rows via deleted_at', async () => {
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Initech', slug: 'initech' })
      .returning();
    if (!org) throw new Error('organization insert failed');

    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ organizationId: org.id, name: 'ToDelete', slug: 'to-delete' })
      .returning();
    if (!workspace) throw new Error('workspace insert failed');

    await db
      .update(schema.workspaces)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workspaces.id, workspace.id));

    const activeWorkspaces = await db
      .select()
      .from(schema.workspaces)
      .where(isNull(schema.workspaces.deletedAt));

    expect(activeWorkspaces.some((w) => w.id === workspace.id)).toBe(false);

    const allWorkspaces = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspace.id));
    expect(allWorkspaces[0]?.deletedAt).not.toBeNull();
  });

  it('rolls back the transaction on throw, leaving no row behind', async () => {
    const marker = 'rollback-marker@example.com';

    await expect(
      withTx(db, async (tx) => {
        await tx.insert(schema.users).values({ email: marker, displayName: 'Rollback User' });
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    const found = await db.select().from(schema.users).where(eq(schema.users.email, marker));
    expect(found).toHaveLength(0);
  });
});
