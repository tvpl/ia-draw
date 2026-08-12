// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services.
import { PGlite } from '@electric-sql/pglite';
import { asc, eq, sql } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordAuditEvent } from './audit.js';
import { MIGRATIONS_FOLDER } from './migrate.js';
import * as schema from './schema.js';

describe('audit_events table + recordAuditEvent (AUTH-03)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    // Applies cleanly on top of T5's initial migration (0000) with no conflict.
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });
  });

  afterAll(async () => {
    await client.close();
  });

  it('inserts via recordAuditEvent and is read back correctly', async () => {
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'auditor@example.com', displayName: 'Auditor' })
      .returning();
    if (!user) throw new Error('user insert failed');

    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Acme', slug: 'acme-audit' })
      .returning();
    if (!org) throw new Error('organization insert failed');

    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ organizationId: org.id, name: 'Platform', slug: 'platform-audit' })
      .returning();
    if (!workspace) throw new Error('workspace insert failed');

    await recordAuditEvent(db, {
      actorId: user.id,
      action: 'workspace.member.added',
      resourceType: 'workspace',
      resourceId: workspace.id,
      ipHash: 'sha256:deadbeef',
      metadataJson: { role: 'editor' },
    });

    const rows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, workspace.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: user.id,
      action: 'workspace.member.added',
      resourceType: 'workspace',
      resourceId: workspace.id,
      ipHash: 'sha256:deadbeef',
      metadataJson: { role: 'editor' },
    });
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
  });

  it('is append-only: two calls produce two rows, never an update', async () => {
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Globex', slug: 'globex-audit' })
      .returning();
    if (!org) throw new Error('organization insert failed');

    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ organizationId: org.id, name: 'Ops', slug: 'ops-audit' })
      .returning();
    if (!workspace) throw new Error('workspace insert failed');

    await recordAuditEvent(db, {
      action: 'workspace.created',
      resourceType: 'workspace',
      resourceId: workspace.id,
    });
    await recordAuditEvent(db, {
      action: 'workspace.updated',
      resourceType: 'workspace',
      resourceId: workspace.id,
    });

    const rows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, workspace.id))
      .orderBy(asc(schema.auditEvents.createdAt));

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.action)).toEqual(['workspace.created', 'workspace.updated']);
  });

  it('accepts a null actorId for system-initiated events', async () => {
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Initech', slug: 'initech-audit' })
      .returning();
    if (!org) throw new Error('organization insert failed');

    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ organizationId: org.id, name: 'System', slug: 'system-audit' })
      .returning();
    if (!workspace) throw new Error('workspace insert failed');

    await recordAuditEvent(db, {
      action: 'workspace.system_check',
      resourceType: 'workspace',
      resourceId: workspace.id,
    });

    const [row] = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceId, workspace.id));
    expect(row?.actorId).toBeNull();
  });

  it('has an index on (resource_type, resource_id) and one on created_at', async () => {
    const indexNames = await db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where tablename = 'audit_events'`,
    );
    const names = indexNames.rows.map((row) => row.indexname);
    expect(names).toContain('audit_events_resource_idx');
    expect(names).toContain('audit_events_created_at_idx');
  });
});
