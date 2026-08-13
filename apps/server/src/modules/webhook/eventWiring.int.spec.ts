// SPEC_DEVIATION: PGlite instead of testcontainers — no Docker in this sandbox (AD-007).
import { randomUUID } from 'node:crypto';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER, webhookDeliveries } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { and, eq } from 'drizzle-orm';
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
import { registerCommentModule } from '../comment/routes.js';
import { registerDiagramSyncModule } from '../diagram-sync/routes.js';
import { registerDocgenModule } from '../docgen/routes.js';
import { registerPresentationPublishModule } from '../presentation/publishRoutes.js';
import { registerPresentationModule } from '../presentation/routes.js';
import type { StorageClient } from '../storage/index.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { registerWebhookModule } from './routes.js';

const TEST_ENCRYPTION_KEY = 'event-wiring-test-encryption-key';

function createFakeStorage(): StorageClient & { objects: Map<string, string> } {
  const objects = new Map<string, string>();
  return {
    objects,
    async putSignedUrl(bucket, key) {
      return `https://fake-storage.test/${bucket}/${key}`;
    },
    async getSignedUrl(bucket, key) {
      return `https://fake-storage.test/${bucket}/${key}`;
    },
    async headObject(bucket, key) {
      const value = objects.get(`${bucket}/${key}`);
      return value !== undefined ? { exists: true, sizeBytes: value.length } : { exists: false };
    },
    async putObject(bucket, key, body) {
      objects.set(`${bucket}/${key}`, Buffer.isBuffer(body) ? body.toString('utf8') : String(body));
    },
    async getObject(bucket, key) {
      const value = objects.get(`${bucket}/${key}`);
      if (value === undefined) throw new Error(`object ${bucket}/${key} not found`);
      return Buffer.from(value, 'utf8');
    },
  };
}

/**
 * The 5 documented event types (docs/product-spec.md §7.3) wired at their
 * real code sites (T80): `diagram.created`/`diagram.updated`
 * (workspace/diagram-sync), `diagram.published` (presentation/publishRoutes,
 * F3), `spec.generated` (docgen, F3), `comment.mentioned` (comment, F3).
 * This suite proves each site actually inserts a `webhook_deliveries` row
 * for a subscribed, enabled endpoint — and that an unsubscribed/disabled
 * endpoint gets nothing — by driving the real REST routes with `app.inject`
 * end-to-end, never calling `enqueueWebhookEvent` directly (that's already
 * covered by `deliver.int.spec.ts`).
 */
describe('webhook event wiring — the 5 documented event sites (T80, EXT-02)', () => {
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
    registerDiagramSyncModule(app, { db });
    registerPresentationModule(app, { db });
    registerPresentationPublishModule(app, { db, storage: createFakeStorage() });
    registerDocgenModule(app, { db, storage: createFakeStorage() });
    registerCommentModule(app, { db });
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

  async function deliveriesFor(workspaceId: string, eventType: string) {
    return db
      .select()
      .from(webhookDeliveries)
      .innerJoin(
        schema.webhookEndpoints,
        eq(webhookDeliveries.webhookEndpointId, schema.webhookEndpoints.id),
      )
      .where(
        and(
          eq(schema.webhookEndpoints.workspaceId, workspaceId),
          eq(webhookDeliveries.eventType, eventType),
        ),
      );
  }

  it('diagram.created / diagram.updated / diagram.published / spec.generated / comment.mentioned each insert a webhook_deliveries row for a subscribed, enabled endpoint', async () => {
    const owner = await seedUserWithSession('wiring-owner');
    const createWs = await app.inject({
      method: 'POST',
      url: '/workspaces',
      cookies: owner.cookies,
      payload: {
        name: 'Wiring WS',
        slug: `wiring-ws-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const workspaceId = createWs.json().workspace.id as string;

    const createHook = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/webhooks`,
      cookies: owner.cookies,
      payload: {
        url: 'https://example.com/all-events',
        events: [
          'diagram.created',
          'diagram.updated',
          'diagram.published',
          'spec.generated',
          'comment.mentioned',
        ],
      },
    });
    expect(createHook.statusCode).toBe(201);

    // ---- diagram.created --------------------------------------------
    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies: owner.cookies,
      payload: { workspaceId, name: 'Wiring project' },
    });
    const projectId = createProject.json().project.id as string;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies: owner.cookies,
      payload: { projectId, title: 'Wiring diagram' },
    });
    expect(createDiagram.statusCode).toBe(201);
    const diagramId = createDiagram.json().diagram.id as string;

    const createdDeliveries = await deliveriesFor(workspaceId, 'diagram.created');
    expect(createdDeliveries).toHaveLength(1);

    // ---- diagram.updated (one per successful operations:batch call) --
    const batch = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies: owner.cookies,
      payload: {
        clientMutationId: randomUUID(),
        baseRevision: 0,
        actorId: owner.user.id,
        deltas: [
          {
            elementId: 'wiring-el-1',
            kind: 'upsert',
            element: { id: 'wiring-el-1', type: 'rectangle', version: 1, versionNonce: 1 },
            version: 1,
            versionNonce: 1,
          },
        ],
      },
    });
    expect(batch.statusCode).toBe(200);

    const updatedDeliveries = await deliveriesFor(workspaceId, 'diagram.updated');
    expect(updatedDeliveries).toHaveLength(1);

    // ---- diagram.published --------------------------------------------
    const createPresentation = await app.inject({
      method: 'POST',
      url: '/presentations',
      cookies: owner.cookies,
      payload: { diagramId, name: 'Wiring presentation' },
    });
    const presentationId = createPresentation.json().presentation.id as string;

    const publish = await app.inject({
      method: 'POST',
      url: `/presentations/${presentationId}:publish`,
      cookies: owner.cookies,
    });
    expect(publish.statusCode).toBe(200);

    const publishedDeliveries = await deliveriesFor(workspaceId, 'diagram.published');
    expect(publishedDeliveries).toHaveLength(1);

    // ---- spec.generated -------------------------------------------------
    const generateSpec = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/specs:generate`,
      cookies: owner.cookies,
    });
    expect(generateSpec.statusCode).toBe(201);

    const specDeliveries = await deliveriesFor(workspaceId, 'spec.generated');
    expect(specDeliveries).toHaveLength(1);

    // ---- comment.mentioned ------------------------------------------
    const mentioned = await seedUserWithSession('wiring-mentioned');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: mentioned.user.id, role: 'viewer' });

    const commentWithMention = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/comments`,
      cookies: owner.cookies,
      payload: { body: `hey @${mentioned.user.id} take a look` },
    });
    expect(commentWithMention.statusCode).toBe(201);
    expect(commentWithMention.json().mentions).toContain(mentioned.user.id);

    const mentionDeliveries = await deliveriesFor(workspaceId, 'comment.mentioned');
    expect(mentionDeliveries).toHaveLength(1);

    // A comment with NO mention fires no `comment.mentioned` event.
    const commentWithoutMention = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/comments`,
      cookies: owner.cookies,
      payload: { body: 'just a plain comment, no mentions here' },
    });
    expect(commentWithoutMention.statusCode).toBe(201);
    const mentionDeliveriesAfter = await deliveriesFor(workspaceId, 'comment.mentioned');
    expect(mentionDeliveriesAfter).toHaveLength(1); // unchanged
  });

  it('a workspace with a webhook NOT subscribed to a given event gets no delivery row for it', async () => {
    const owner = await seedUserWithSession('unsub-owner');
    const createWs = await app.inject({
      method: 'POST',
      url: '/workspaces',
      cookies: owner.cookies,
      payload: {
        name: 'Unsub WS',
        slug: `unsub-ws-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const workspaceId = createWs.json().workspace.id as string;

    await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/webhooks`,
      cookies: owner.cookies,
      payload: { url: 'https://example.com/only-published', events: ['diagram.published'] },
    });

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies: owner.cookies,
      payload: { workspaceId, name: 'Unsub project' },
    });
    const projectId = createProject.json().project.id as string;

    await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies: owner.cookies,
      payload: { projectId, title: 'Unsub diagram' },
    });

    const createdDeliveries = await deliveriesFor(workspaceId, 'diagram.created');
    expect(createdDeliveries).toHaveLength(0);
  });

  it('a disabled webhook endpoint gets no delivery row for any event', async () => {
    const owner = await seedUserWithSession('disabled-owner');
    const createWs = await app.inject({
      method: 'POST',
      url: '/workspaces',
      cookies: owner.cookies,
      payload: {
        name: 'Disabled WS',
        slug: `disabled-ws-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const workspaceId = createWs.json().workspace.id as string;

    await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/webhooks`,
      cookies: owner.cookies,
      payload: {
        url: 'https://example.com/disabled',
        events: ['diagram.created'],
        enabled: false,
      },
    });

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies: owner.cookies,
      payload: { workspaceId, name: 'Disabled project' },
    });
    const projectId = createProject.json().project.id as string;

    await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies: owner.cookies,
      payload: { projectId, title: 'Disabled diagram' },
    });

    const createdDeliveries = await deliveriesFor(workspaceId, 'diagram.created');
    expect(createdDeliveries).toHaveLength(0);
  });
});
