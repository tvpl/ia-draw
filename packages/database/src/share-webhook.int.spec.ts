// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).
import { decryptToken, encryptToken } from '@arch-canvas/ai-tools';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from './migrate.js';
import * as schema from './schema.js';

describe('share_links + webhook_endpoints/webhook_deliveries schema (T71, EXT-01/02)', () => {
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

  async function seedWorkspaceAndDiagram(slugSuffix: string) {
    const [user] = await db
      .insert(schema.users)
      .values({ email: `share-${slugSuffix}@example.com`, displayName: `User ${slugSuffix}` })
      .returning();
    if (!user) throw new Error('user insert failed');

    const [org] = await db
      .insert(schema.organizations)
      .values({ name: `Org ${slugSuffix}`, slug: `org-share-${slugSuffix}` })
      .returning();
    if (!org) throw new Error('organization insert failed');

    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ organizationId: org.id, name: `WS ${slugSuffix}`, slug: `ws-share-${slugSuffix}` })
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
      expect.arrayContaining(['share_links', 'webhook_endpoints', 'webhook_deliveries']),
    );
  });

  it('inserts one row in each of the 3 new tables with valid FKs', async () => {
    const { user, workspace, diagram } = await seedWorkspaceAndDiagram('insert-all');

    const [link] = await db
      .insert(schema.shareLinks)
      .values({
        resourceType: 'diagram',
        resourceId: diagram.id,
        tokenHash: 'a'.repeat(64),
        role: 'viewer',
        expiresAt: new Date(Date.now() + 60_000),
        createdBy: user.id,
      })
      .returning();
    expect(link).toMatchObject({
      resourceType: 'diagram',
      resourceId: diagram.id,
      role: 'viewer',
      revokedAt: null,
    });

    const [endpoint] = await db
      .insert(schema.webhookEndpoints)
      .values({
        workspaceId: workspace.id,
        url: 'https://example.com/hooks/arch-canvas',
        secretEncrypted: encryptToken('super-secret-value', 'test-master-key'),
        eventsJson: ['diagram.created', 'diagram.published'],
        createdBy: user.id,
      })
      .returning();
    expect(endpoint).toMatchObject({
      workspaceId: workspace.id,
      url: 'https://example.com/hooks/arch-canvas',
      enabled: true,
      eventsJson: ['diagram.created', 'diagram.published'],
    });
    if (!endpoint) throw new Error('endpoint insert failed');

    const [delivery] = await db
      .insert(schema.webhookDeliveries)
      .values({
        webhookEndpointId: endpoint.id,
        eventType: 'diagram.created',
        payloadJson: { diagramId: diagram.id },
      })
      .returning();
    expect(delivery).toMatchObject({
      webhookEndpointId: endpoint.id,
      eventType: 'diagram.created',
      status: 'pending',
      attempts: 0,
      nextRetryAt: null,
    });
  });

  it('rejects a duplicate token_hash on share_links (unique index)', async () => {
    const { user, diagram } = await seedWorkspaceAndDiagram('dup-token');
    const tokenHash = 'b'.repeat(64);

    await db.insert(schema.shareLinks).values({
      resourceType: 'diagram',
      resourceId: diagram.id,
      tokenHash,
      role: 'reviewer',
      expiresAt: new Date(Date.now() + 60_000),
      createdBy: user.id,
    });

    await expect(
      db.insert(schema.shareLinks).values({
        resourceType: 'diagram',
        resourceId: diagram.id,
        tokenHash,
        role: 'editor',
        expiresAt: new Date(Date.now() + 60_000),
        createdBy: user.id,
      }),
    ).rejects.toThrow();
  });

  it('webhook_endpoints has no plaintext token/secret column — only secret_encrypted', async () => {
    const columns = await db.execute<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'webhook_endpoints'`,
    );
    const names = columns.rows.map((r) => r.column_name);
    expect(names).toContain('secret_encrypted');
    const suspicious = names.filter(
      (name) => (name.includes('token') || name.includes('secret')) && name !== 'secret_encrypted',
    );
    expect(suspicious).toEqual([]);
  });

  it('webhook_endpoints.secret_encrypted round-trips through encryptToken/decryptToken and is never the recognizable plaintext', async () => {
    const { user, workspace } = await seedWorkspaceAndDiagram('crypto-roundtrip');
    const plaintext = 'whsec_super-secret-hmac-key-0123456789';
    const masterKey = 'test-master-key-for-webhook-secrets';
    const ciphertext = encryptToken(plaintext, masterKey);

    expect(ciphertext).not.toContain(plaintext);
    expect(ciphertext.includes('whsec_')).toBe(false);

    const [endpoint] = await db
      .insert(schema.webhookEndpoints)
      .values({
        workspaceId: workspace.id,
        url: 'https://example.com/hooks/roundtrip',
        secretEncrypted: ciphertext,
        eventsJson: ['spec.generated'],
        createdBy: user.id,
      })
      .returning();
    if (!endpoint) throw new Error('endpoint insert failed');

    // Not a recognizable plaintext string as persisted either.
    expect(endpoint.secretEncrypted).not.toContain(plaintext);
    expect(decryptToken(endpoint.secretEncrypted, masterKey)).toBe(plaintext);
  });

  it('indexes webhook_deliveries on (status, next_retry_at) for the retry worker scan', async () => {
    const indexes = await db.execute<{ indexname: string }>(
      `select indexname from pg_indexes where tablename = 'webhook_deliveries'`,
    );
    const names = indexes.rows.map((r) => r.indexname);
    expect(names).toContain('webhook_deliveries_status_next_retry_idx');
  });

  it('rejects a webhook_deliveries insert referencing a non-existent webhook_endpoint_id (FK enforced)', async () => {
    const missingEndpointId = '00000000-0000-0000-0000-000000000000';
    await expect(
      db.insert(schema.webhookDeliveries).values({
        webhookEndpointId: missingEndpointId,
        eventType: 'diagram.created',
        payloadJson: {},
      }),
    ).rejects.toThrow();
  });
});
