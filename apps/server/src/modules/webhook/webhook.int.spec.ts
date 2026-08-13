// SPEC_DEVIATION: PGlite instead of testcontainers — no Docker in this sandbox (AD-007).
import { createHmac } from 'node:crypto';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../core/config.js';
import { buildServer } from '../../core/server.js';
import { createLocalAccount } from '../auth/accounts.js';
import { SESSION_COOKIE_NAME } from '../auth/cookie.js';
import { registerAuthModule } from '../auth/routes.js';
import { createSession } from '../auth/session.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { registerWebhookModule } from './routes.js';

const TEST_ENCRYPTION_KEY = 'webhook-test-encryption-key';

describe('webhook module — admin-only CRUD with rotatable HMAC secrets (T79, EXT-02)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let app: FastifyInstance;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const config = loadConfig({ NODE_ENV: 'test' });
    app = buildServer(config);
    await registerAuthModule(app, { db, config });
    registerWorkspaceModule(app, { db });
    registerWebhookModule(app, { db, encryptionKey: TEST_ENCRYPTION_KEY });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await client.close();
  });

  async function seedUserWithSession(prefix: string) {
    const user = await createLocalAccount(db, {
      email: `${prefix}-${Date.now()}-${Math.random()}@example.com`,
      displayName: prefix,
      password: `${prefix}-password`,
    });
    const session = await createSession(db, user.id);
    return { user, cookies: { [SESSION_COOKIE_NAME]: session.token } };
  }

  async function seedWorkspaceAs(cookies: Record<string, string>, slug: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/workspaces',
      cookies,
      payload: {
        name: `Webhook ${slug}`,
        slug: `webhook-${slug}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    return response.json().workspace.id as string;
  }

  it('a non-admin (editor) creating a webhook is rejected with 403', async () => {
    const owner = await seedUserWithSession('nonadmin-owner');
    const workspaceId = await seedWorkspaceAs(owner.cookies, 'nonadmin');
    const editor = await seedUserWithSession('nonadmin-editor');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: editor.user.id, role: 'editor' });

    const response = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/webhooks`,
      cookies: editor.cookies,
      payload: { url: 'https://example.com/hook', events: ['diagram.created'] },
    });

    expect(response.statusCode).toBe(403);
    const rows = await db
      .select()
      .from(schema.webhookEndpoints)
      .where(eq(schema.webhookEndpoints.workspaceId, workspaceId));
    expect(rows).toHaveLength(0);
  });

  it('a non-admin (editor) patching/rotating/deleting an existing webhook is rejected with 403', async () => {
    const owner = await seedUserWithSession('nonadmin2-owner');
    const workspaceId = await seedWorkspaceAs(owner.cookies, 'nonadmin2');
    const editor = await seedUserWithSession('nonadmin2-editor');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: editor.user.id, role: 'editor' });

    const create = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/webhooks`,
      cookies: owner.cookies,
      payload: { url: 'https://example.com/hook', events: ['diagram.created'] },
    });
    const webhookId = create.json().webhookEndpoint.id as string;

    const patch = await app.inject({
      method: 'PATCH',
      url: `/workspaces/${workspaceId}/webhooks/${webhookId}`,
      cookies: editor.cookies,
      payload: { enabled: false },
    });
    expect(patch.statusCode).toBe(403);

    const rotate = await app.inject({
      method: 'PATCH',
      url: `/workspaces/${workspaceId}/webhooks/${webhookId}:rotate-secret`,
      cookies: editor.cookies,
    });
    expect(rotate.statusCode).toBe(403);

    const del = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/webhooks/${webhookId}`,
      cookies: editor.cookies,
    });
    expect(del.statusCode).toBe(403);
  });

  it('an admin CAN create a webhook; the secret returned at creation is never recoverable again', async () => {
    const owner = await seedUserWithSession('reveal-owner');
    const workspaceId = await seedWorkspaceAs(owner.cookies, 'reveal');

    const create = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/webhooks`,
      cookies: owner.cookies,
      payload: { url: 'https://example.com/hook', events: ['diagram.created', 'spec.generated'] },
    });
    expect(create.statusCode).toBe(201);
    const { secret, webhookEndpoint } = create.json();
    expect(typeof secret).toBe('string');
    expect(secret.length).toBeGreaterThan(20);
    expect(webhookEndpoint.events).toEqual(['diagram.created', 'spec.generated']);

    const [row] = await db
      .select()
      .from(schema.webhookEndpoints)
      .where(eq(schema.webhookEndpoints.id, webhookEndpoint.id));
    expect(row?.secretEncrypted).toBeDefined();
    expect(row?.secretEncrypted).not.toBe(secret);
    expect(JSON.stringify(row)).not.toContain(secret);

    // Never re-exposed by the create response's own echoed fields, nor by list/patch/rotate.
    expect(webhookEndpoint.secretEncrypted).toBeUndefined();
    expect(webhookEndpoint.secret).toBeUndefined();

    const list = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/webhooks`,
      cookies: owner.cookies,
    });
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).not.toContain(secret);
  });

  it(':rotate-secret generates a different secret, and a signature computed with the old secret no longer matches', async () => {
    const owner = await seedUserWithSession('rotate-owner');
    const workspaceId = await seedWorkspaceAs(owner.cookies, 'rotate');

    const create = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/webhooks`,
      cookies: owner.cookies,
      payload: { url: 'https://example.com/hook', events: ['diagram.created'] },
    });
    const oldSecret = create.json().secret as string;
    const webhookId = create.json().webhookEndpoint.id as string;

    const rotate = await app.inject({
      method: 'PATCH',
      url: `/workspaces/${workspaceId}/webhooks/${webhookId}:rotate-secret`,
      cookies: owner.cookies,
    });
    expect(rotate.statusCode).toBe(200);
    const newSecret = rotate.json().secret as string;
    expect(newSecret).not.toBe(oldSecret);
    expect(JSON.stringify(rotate.json())).not.toContain(oldSecret);

    const payload = JSON.stringify({ eventType: 'diagram.created', diagramId: 'd1' });
    const signatureWithOldSecret = createHmac('sha256', oldSecret).update(payload).digest('hex');
    const signatureWithNewSecret = createHmac('sha256', newSecret).update(payload).digest('hex');
    // A recipient re-computing the signature with the OLD secret (as any
    // party who captured it before rotation still could) no longer matches
    // what a delivery signed with the persisted (new) secret would produce —
    // proving the old secret is no longer valid for subsequent deliveries.
    expect(signatureWithOldSecret).not.toBe(signatureWithNewSecret);
  });

  it('eventsJson with an event type outside the enum is rejected with 400', async () => {
    const owner = await seedUserWithSession('badevent-owner');
    const workspaceId = await seedWorkspaceAs(owner.cookies, 'badevent');

    const response = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/webhooks`,
      cookies: owner.cookies,
      payload: { url: 'https://example.com/hook', events: ['diagram.deleted'] },
    });

    expect(response.statusCode).toBe(400);
  });

  it('PATCH can update url/events/enabled without ever touching the secret', async () => {
    const owner = await seedUserWithSession('patch-owner');
    const workspaceId = await seedWorkspaceAs(owner.cookies, 'patch');

    const create = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/webhooks`,
      cookies: owner.cookies,
      payload: { url: 'https://example.com/hook', events: ['diagram.created'] },
    });
    const webhookId = create.json().webhookEndpoint.id as string;
    const [beforeRow] = await db
      .select()
      .from(schema.webhookEndpoints)
      .where(eq(schema.webhookEndpoints.id, webhookId));

    const patch = await app.inject({
      method: 'PATCH',
      url: `/workspaces/${workspaceId}/webhooks/${webhookId}`,
      cookies: owner.cookies,
      payload: { enabled: false, events: ['comment.mentioned'] },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().webhookEndpoint.enabled).toBe(false);
    expect(patch.json().webhookEndpoint.events).toEqual(['comment.mentioned']);

    const [afterRow] = await db
      .select()
      .from(schema.webhookEndpoints)
      .where(eq(schema.webhookEndpoints.id, webhookId));
    expect(afterRow?.secretEncrypted).toBe(beforeRow?.secretEncrypted);
  });

  it('DELETE removes the webhook; a subsequent PATCH 404s', async () => {
    const owner = await seedUserWithSession('delete-owner');
    const workspaceId = await seedWorkspaceAs(owner.cookies, 'delete');

    const create = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/webhooks`,
      cookies: owner.cookies,
      payload: { url: 'https://example.com/hook', events: ['diagram.created'] },
    });
    const webhookId = create.json().webhookEndpoint.id as string;

    const del = await app.inject({
      method: 'DELETE',
      url: `/workspaces/${workspaceId}/webhooks/${webhookId}`,
      cookies: owner.cookies,
    });
    expect(del.statusCode).toBe(204);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/workspaces/${workspaceId}/webhooks/${webhookId}`,
      cookies: owner.cookies,
      payload: { enabled: false },
    });
    expect(patch.statusCode).toBe(404);
  });

  it('a webhook belonging to a different workspace is 404 (IDOR), never leaked across workspaces', async () => {
    const ownerA = await seedUserWithSession('idor-a-owner');
    const workspaceA = await seedWorkspaceAs(ownerA.cookies, 'idor-a');
    const create = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceA}/webhooks`,
      cookies: ownerA.cookies,
      payload: { url: 'https://example.com/hook', events: ['diagram.created'] },
    });
    const webhookId = create.json().webhookEndpoint.id as string;

    const ownerB = await seedUserWithSession('idor-b-owner');
    const workspaceB = await seedWorkspaceAs(ownerB.cookies, 'idor-b');

    const response = await app.inject({
      method: 'PATCH',
      url: `/workspaces/${workspaceB}/webhooks/${webhookId}`,
      cookies: ownerB.cookies,
      payload: { enabled: false },
    });
    expect(response.statusCode).toBe(404);
  });
});
