// SPEC_DEVIATION: PGlite instead of testcontainers — no Docker in this sandbox (AD-007).
import { randomUUID } from 'node:crypto';
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
import { registerDiagramSyncModule } from '../diagram-sync/routes.js';
import type { StorageClient } from '../storage/signedUrl.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { registerPresentationPublishModule } from './publishRoutes.js';
import { registerPresentationModule } from './routes.js';

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

describe('presentation module — publish, read-only link, PDF export (T66, PRS-02/05)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let app: FastifyInstance;
  let storage: ReturnType<typeof createFakeStorage>;

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
    storage = createFakeStorage();
    registerPresentationPublishModule(app, { db, storage });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await client.close();
  });

  async function seedUserWithSession(emailPrefix: string) {
    const user = await createLocalAccount(db, {
      email: `${emailPrefix}-${Date.now()}-${Math.random()}@example.com`,
      displayName: emailPrefix,
      password: `${emailPrefix}-password`,
    });
    const session = await createSession(db, user.id);
    return { user, cookies: { [SESSION_COOKIE_NAME]: session.token } };
  }

  async function seedDiagramAs(cookies: Record<string, string>, slug: string) {
    const createWs = await app.inject({
      method: 'POST',
      url: '/workspaces',
      cookies,
      payload: { name: `Pub WS ${slug}`, slug: `pub-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id as string;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Pub Project ${slug}` },
    });
    const projectId = createProject.json().project.id as string;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Pub Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id as string };
  }

  async function addRectangle(
    cookies: Record<string, string>,
    diagramId: string,
    actorId: string,
    elementId: string,
    version: number,
    extra: Record<string, unknown> = {},
  ) {
    return app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies,
      payload: {
        clientMutationId: randomUUID(),
        baseRevision: version - 1,
        actorId,
        deltas: [
          {
            elementId,
            kind: 'upsert' as const,
            element: {
              id: elementId,
              type: 'rectangle',
              x: 0,
              y: 0,
              width: 100,
              height: 50,
              version,
              versionNonce: version,
              ...extra,
            },
            version,
            versionNonce: version,
          },
        ],
      },
    });
  }

  async function createPresentation(
    cookies: Record<string, string>,
    diagramId: string,
    frameCount: number,
  ) {
    const create = await app.inject({
      method: 'POST',
      url: '/presentations',
      cookies,
      payload: { diagramId, name: 'Deck' },
    });
    const presentationId = create.json().presentation.id as string;
    for (let i = 0; i < frameCount; i++) {
      await app.inject({
        method: 'POST',
        url: `/presentations/${presentationId}/frames`,
        cookies,
        payload: { frameId: `logical-${i}`, position: i },
      });
    }
    return presentationId;
  }

  it(':publish creates an immutable "published" snapshot and links publishedSnapshotId', async () => {
    const owner = await seedUserWithSession('pub-happy');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'happy');
    await addRectangle(owner.cookies, diagramId, owner.user.id, 'el-1', 1);
    const presentationId = await createPresentation(owner.cookies, diagramId, 1);

    const publish = await app.inject({
      method: 'POST',
      url: `/presentations/${presentationId}:publish`,
      cookies: owner.cookies,
    });
    expect(publish.statusCode).toBe(200);
    const { presentation } = publish.json();
    expect(presentation.publishedSnapshotId).toBeTruthy();

    const [snapshot] = await db
      .select()
      .from(schema.diagramSnapshots)
      .where(eq(schema.diagramSnapshots.id, presentation.publishedSnapshotId));
    expect(snapshot?.kind).toBe('published');
    expect(snapshot?.immutable).toBe(true);

    // SEC-04: exactly one audit_events row for this publish.
    const auditRows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, 'presentation.published'));
    const matching = auditRows.filter((row) => row.resourceId === presentationId);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({
      actorId: owner.user.id,
      action: 'presentation.published',
      resourceType: 'presentation',
      resourceId: presentationId,
    });
    expect(matching[0]?.metadataJson).toMatchObject({
      diagramId,
      publishedSnapshotId: presentation.publishedSnapshotId,
    });
  });

  it('GET .../published keeps serving the SNAPSHOT scene after a later live edit, never the live scene', async () => {
    const owner = await seedUserWithSession('pub-frozen');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'frozen');
    await addRectangle(owner.cookies, diagramId, owner.user.id, 'el-1', 1);
    const presentationId = await createPresentation(owner.cookies, diagramId, 1);

    await app.inject({
      method: 'POST',
      url: `/presentations/${presentationId}:publish`,
      cookies: owner.cookies,
    });

    const beforeMutation = await app.inject({
      method: 'GET',
      url: `/presentations/${presentationId}/published`,
      cookies: owner.cookies,
    });
    const sceneIdsBefore = (beforeMutation.json().scene as Array<{ id: string }>)
      .map((el) => el.id)
      .sort();
    expect(sceneIdsBefore).toEqual(['el-1']);

    // Mutate the LIVE scene after publishing.
    await addRectangle(owner.cookies, diagramId, owner.user.id, 'el-2', 1);

    const afterMutation = await app.inject({
      method: 'GET',
      url: `/presentations/${presentationId}/published`,
      cookies: owner.cookies,
    });
    const sceneIdsAfter = (afterMutation.json().scene as Array<{ id: string }>)
      .map((el) => el.id)
      .sort();
    // Still exactly the frozen snapshot's content — 'el-2' never appears.
    expect(sceneIdsAfter).toEqual(['el-1']);
  });

  it('settingsJson.expiresAt in the past makes GET .../published return 404', async () => {
    const owner = await seedUserWithSession('pub-expired');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'expired');
    await addRectangle(owner.cookies, diagramId, owner.user.id, 'el-1', 1);
    const presentationId = await createPresentation(owner.cookies, diagramId, 1);

    await app.inject({
      method: 'POST',
      url: `/presentations/${presentationId}:publish`,
      cookies: owner.cookies,
    });
    await app.inject({
      method: 'PATCH',
      url: `/presentations/${presentationId}`,
      cookies: owner.cookies,
      payload: { settingsJson: { expiresAt: '2000-01-01T00:00:00.000Z' } },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/presentations/${presentationId}/published`,
      cookies: owner.cookies,
    });
    expect(response.statusCode).toBe(404);
  });

  it(':export-pdf of a 3-frame presentation produces a PDF with 3 pages, rendered from the published snapshot', async () => {
    const owner = await seedUserWithSession('pub-pdf');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'pdf');
    await addRectangle(owner.cookies, diagramId, owner.user.id, 'el-1', 1);
    await addRectangle(owner.cookies, diagramId, owner.user.id, 'el-2', 1);
    await addRectangle(owner.cookies, diagramId, owner.user.id, 'el-3', 1);
    const presentationId = await createPresentation(owner.cookies, diagramId, 3);

    await app.inject({
      method: 'POST',
      url: `/presentations/${presentationId}:publish`,
      cookies: owner.cookies,
    });

    const exportResponse = await app.inject({
      method: 'POST',
      url: `/presentations/${presentationId}:export-pdf`,
      cookies: owner.cookies,
    });
    expect(exportResponse.statusCode).toBe(200);
    const { url, pageCount } = exportResponse.json();
    expect(pageCount).toBe(3);
    expect(url).toContain('presentations/');

    const key = Array.from(storage.objects.keys()).find((k) => k.includes(presentationId));
    expect(key).toBeDefined();
    const pdfText = storage.objects.get(key as string) as string;
    expect(pdfText.startsWith('%PDF-')).toBe(true);
  });

  it(':export-pdf before :publish returns 404 (nothing published yet)', async () => {
    const owner = await seedUserWithSession('pub-unpublished');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'unpublished');
    await addRectangle(owner.cookies, diagramId, owner.user.id, 'el-1', 1);
    const presentationId = await createPresentation(owner.cookies, diagramId, 1);

    const response = await app.inject({
      method: 'POST',
      url: `/presentations/${presentationId}:export-pdf`,
      cookies: owner.cookies,
    });
    expect(response.statusCode).toBe(404);
  });

  it('a reviewer receives 403 on :publish; a viewer can still GET the published link', async () => {
    const owner = await seedUserWithSession('pub-rbac-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'rbac');
    await addRectangle(owner.cookies, diagramId, owner.user.id, 'el-1', 1);
    const presentationId = await createPresentation(owner.cookies, diagramId, 1);
    await app.inject({
      method: 'POST',
      url: `/presentations/${presentationId}:publish`,
      cookies: owner.cookies,
    });

    const reviewer = await seedUserWithSession('pub-rbac-reviewer');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: reviewer.user.id, role: 'reviewer' });
    const publishAsReviewer = await app.inject({
      method: 'POST',
      url: `/presentations/${presentationId}:publish`,
      cookies: reviewer.cookies,
    });
    expect(publishAsReviewer.statusCode).toBe(403);

    const viewer = await seedUserWithSession('pub-rbac-viewer');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: viewer.user.id, role: 'viewer' });
    const readAsViewer = await app.inject({
      method: 'GET',
      url: `/presentations/${presentationId}/published`,
      cookies: viewer.cookies,
    });
    expect(readAsViewer.statusCode).toBe(200);
  });
});
