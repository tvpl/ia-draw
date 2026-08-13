// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI uses real Postgres via GitHub Actions services (AD-007).
//
// Storage is an in-memory fake StorageClient (no real MinIO in this sandbox, T27's
// documented limitation), storing raw `Buffer`s (not strings — T33's bundle/PDF/PNG
// bytes are binary, unlike the JSON-only fakes some earlier int specs use) so unzip and
// checksum assertions below operate on real bytes, not a lossy utf8 round-trip.
import { createHash, randomUUID } from 'node:crypto';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import JSZip from 'jszip';
import { fromPglite } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../core/config.js';
import { buildServer } from '../../core/server.js';
import { insertPendingAsset, markAssetReady } from '../asset/index.js';
import { createLocalAccount } from '../auth/accounts.js';
import { SESSION_COOKIE_NAME } from '../auth/cookie.js';
import { registerAuthModule } from '../auth/routes.js';
import { createSession } from '../auth/session.js';
import { registerDiagramSyncModule } from '../diagram-sync/routes.js';
import { type JobQueue, startJobs } from '../jobs/index.js';
import { ASSET_BUCKET } from '../storage/index.js';
import type { StorageClient } from '../storage/signedUrl.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { registerBulkBundleJob } from './bulkBundle.js';
import { registerExportModule } from './routes.js';

function createFakeStorage(): StorageClient & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
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
      objects.set(`${bucket}/${key}`, Buffer.isBuffer(body) ? body : Buffer.from(body as string));
    },
    async getObject(bucket, key) {
      const value = objects.get(`${bucket}/${key}`);
      if (value === undefined) throw new Error(`object ${bucket}/${key} not found`);
      return value;
    },
  };
}

/** `url` is always this fake's own `https://fake-storage.test/{bucket}/{key}` shape. */
function objectFromUrl(storage: ReturnType<typeof createFakeStorage>, url: string): Buffer {
  const key = url.replace('https://fake-storage.test/', '');
  const bytes = storage.objects.get(key);
  if (!bytes) throw new Error(`no object stored for url ${url}`);
  return bytes;
}

describe('export module routes (T32/T33 — EXP-01..04)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let app: FastifyInstance;
  let storage: ReturnType<typeof createFakeStorage>;
  let jobs: JobQueue;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });
    storage = createFakeStorage();

    const config = loadConfig({ NODE_ENV: 'test' });
    jobs = await startJobs(config, { db: fromPglite(client), backend: 'pglite' });

    app = buildServer(config);
    await registerAuthModule(app, { db, config });
    registerWorkspaceModule(app, { db });
    registerDiagramSyncModule(app, { db });
    registerExportModule(app, { db, storage, jobs });
    await registerBulkBundleJob(jobs, db, storage);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await jobs.stop({ graceful: false });
    await client.close();
  });

  let seedCounter = 0;
  async function seedUserWithSession(prefix: string) {
    seedCounter += 1;
    const user = await createLocalAccount(db, {
      email: `${prefix}-${seedCounter}-${Date.now()}@example.com`,
      displayName: prefix,
      password: `${prefix}-password`,
    });
    const session = await createSession(db, user.id);
    return { user, cookies: { [SESSION_COOKIE_NAME]: session.token } };
  }

  async function seedDiagram(cookies: Record<string, string>, slug: string) {
    const createWs = await app.inject({
      method: 'POST',
      url: '/workspaces',
      cookies,
      payload: {
        name: `Export WS ${slug}`,
        slug: `export-ws-${slug}-${seedCounter}-${Date.now()}`,
      },
    });
    const workspaceId = createWs.json().workspace.id as string;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Export Project ${slug}` },
    });
    const projectId = createProject.json().project.id as string;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Export Diagram ${slug}` },
    });
    const diagramId = createDiagram.json().diagram.id as string;

    return { workspaceId, projectId, diagramId };
  }

  async function addRectangleElement(
    cookies: Record<string, string>,
    diagramId: string,
    actorId: string,
  ) {
    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies,
      payload: {
        clientMutationId: randomUUID(),
        baseRevision: 0,
        actorId,
        deltas: [
          {
            elementId: 'rect-1',
            kind: 'upsert' as const,
            element: {
              id: 'rect-1',
              type: 'rectangle',
              x: 0,
              y: 0,
              width: 100,
              height: 50,
              version: 1,
              versionNonce: 1,
            },
            version: 1,
            versionNonce: 1,
          },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
  }

  describe('POST /diagrams/:id/exports (T32, EXP-01)', () => {
    it('generates all 4 formats with checksums matching the stored bytes', async () => {
      const owner = await seedUserWithSession('exp-owner');
      const { diagramId } = await seedDiagram(owner.cookies, 'exp-happy');
      await addRectangleElement(owner.cookies, diagramId, owner.user.id);

      const response = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/exports`,
        cookies: owner.cookies,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.revision).toBe(1);

      for (const format of ['excalidraw', 'svg', 'png', 'pdf'] as const) {
        const entry = body.formats[format];
        const bytes = objectFromUrl(storage, entry.url);
        const actualChecksum = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
        expect(entry.checksum).toBe(actualChecksum);
        expect(bytes.length).toBe(entry.sizeBytes);
      }
      expect(objectFromUrl(storage, body.formats.pdf.url).subarray(0, 5).toString('latin1')).toBe(
        '%PDF-',
      );

      // SEC-04: exactly one audit_events row for this export generation.
      const auditRows = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.action, 'diagram.export.generated'));
      const matching = auditRows.filter((row) => row.resourceId === diagramId);
      expect(matching).toHaveLength(1);
      expect(matching[0]).toMatchObject({
        actorId: owner.user.id,
        action: 'diagram.export.generated',
        resourceType: 'diagram',
        resourceId: diagramId,
      });
    });

    it('requires an authenticated session (401, not 404 — proves the route is reachable)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/diagrams/${randomUUID()}/exports`,
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /diagrams/:id/bundle (T33, EXP-02)', () => {
    it('produces a .zip whose scene + asset + manifest checksums match the real unzipped bytes', async () => {
      const owner = await seedUserWithSession('bundle-owner');
      const { workspaceId, diagramId } = await seedDiagram(owner.cookies, 'bundle-happy');

      const assetId = randomUUID();
      const assetBytes = Buffer.from('fake-png-bytes-for-bundle-test');
      await insertPendingAsset(db, {
        id: assetId,
        workspaceId,
        diagramId,
        mimeType: 'image/png',
        sizeBytes: assetBytes.length,
        objectKey: `diagrams/${diagramId}/assets/${assetId}`,
        createdBy: owner.user.id,
      });
      storage.objects.set(`${ASSET_BUCKET}/diagrams/${diagramId}/assets/${assetId}`, assetBytes);
      await markAssetReady(db, assetId, {
        checksum: `sha256:${createHash('sha256').update(assetBytes).digest('hex')}`,
        sizeBytes: assetBytes.length,
        objectKey: `diagrams/${diagramId}/assets/${assetId}`,
      });

      const imageResponse = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/operations:batch`,
        cookies: owner.cookies,
        payload: {
          clientMutationId: randomUUID(),
          baseRevision: 0,
          actorId: owner.user.id,
          deltas: [
            {
              elementId: 'img-1',
              kind: 'upsert' as const,
              element: { id: 'img-1', type: 'image', fileId: assetId, version: 1, versionNonce: 1 },
              version: 1,
              versionNonce: 1,
            },
          ],
        },
      });
      expect(imageResponse.statusCode).toBe(200);

      const response = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/bundle`,
        cookies: owner.cookies,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      const zipBytes = objectFromUrl(storage, body.url);

      const zip = await JSZip.loadAsync(zipBytes);
      const fileEntries = Object.values(zip.files)
        .filter((entry) => !entry.dir)
        .map((entry) => entry.name);
      expect(fileEntries.sort()).toEqual(
        ['scene.excalidraw', 'metadata.json', `assets/${assetId}.png`, 'manifest.json'].sort(),
      );

      for (const entry of body.manifest.files as { path: string; sha256: string }[]) {
        const unzipped = await zip.file(entry.path)?.async('nodebuffer');
        expect(unzipped).toBeDefined();
        const actualChecksum = createHash('sha256')
          .update(unzipped as Buffer)
          .digest('hex');
        expect(entry.sha256).toBe(actualChecksum);
      }

      const sceneBytes = await zip.file('scene.excalidraw')?.async('nodebuffer');
      expect(sceneBytes?.toString('utf8')).toContain('"img-1"');
      const unzippedAsset = await zip.file(`assets/${assetId}.png`)?.async('nodebuffer');
      expect(unzippedAsset).toEqual(assetBytes);

      // SEC-04: exactly one audit_events row for this bundle generation.
      const auditRows = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.action, 'diagram.export.bundle_generated'));
      const matching = auditRows.filter((row) => row.resourceId === diagramId);
      expect(matching).toHaveLength(1);
      expect(matching[0]).toMatchObject({
        actorId: owner.user.id,
        action: 'diagram.export.bundle_generated',
        resourceType: 'diagram',
        resourceId: diagramId,
      });
    });
  });

  describe('POST /projects/:id/import (T33, EXP-03)', () => {
    function excalidrawFile(elements: unknown[]) {
      return JSON.stringify({
        type: 'architecture-canvas/scene',
        version: 1,
        elements,
        appState: {
          viewBackgroundColor: '#ffffff',
          gridSize: 0,
          gridStep: 5,
          gridModeEnabled: false,
          zenModeEnabled: false,
          theme: 'light',
          name: null,
        },
      });
    }

    it('preview-only (no confirm) validates the file and returns a preview WITHOUT creating a diagram', async () => {
      const owner = await seedUserWithSession('import-preview');
      const { projectId } = await seedDiagram(owner.cookies, 'import-preview');

      const response = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/import`,
        cookies: owner.cookies,
        payload: { fileContent: excalidrawFile([{ id: 'a', type: 'rectangle', version: 1 }]) },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.preview.elementCount).toBe(1);
      expect(body.diagram).toBeUndefined();

      const list = await app.inject({
        method: 'GET',
        url: `/diagrams?projectId=${projectId}`,
        cookies: owner.cookies,
      });
      // Only the one diagram seedDiagram itself created — preview never created a second one.
      expect(list.json().items).toHaveLength(1);
    });

    it('rejects a malformed .excalidraw file with a clear 400 before any diagram is created', async () => {
      const owner = await seedUserWithSession('import-malformed');
      const { projectId } = await seedDiagram(owner.cookies, 'import-malformed');

      const response = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/import`,
        cookies: owner.cookies,
        payload: { fileContent: '{ this is not valid json' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().detail ?? response.json().title).toMatch(
        /malformed \.excalidraw file/,
      );
    });

    it('confirm=true creates a new diagram seeded with the imported elements', async () => {
      const owner = await seedUserWithSession('import-confirm');
      const { projectId } = await seedDiagram(owner.cookies, 'import-confirm');

      const response = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/import`,
        cookies: owner.cookies,
        payload: {
          fileContent: excalidrawFile([
            { id: 'imported-1', type: 'rectangle', version: 1, versionNonce: 1 },
          ]),
          confirm: true,
          title: 'Imported Diagram',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.diagram.title).toBe('Imported Diagram');

      const bootstrap = await app.inject({
        method: 'GET',
        url: `/diagrams/${body.diagram.id}/bootstrap`,
        cookies: owner.cookies,
      });
      expect(bootstrap.statusCode).toBe(200);
      expect(bootstrap.json().revision).toBe(1);
      expect(bootstrap.json().scene).toHaveLength(1);
      expect(bootstrap.json().scene[0].id).toBe('imported-1');
    });
  });

  describe('POST /workspaces/:id/bundles (T33, EXP-04 — workspace_admin only)', () => {
    it('workspace_admin can enqueue a bulk export (queued, not 403)', async () => {
      const admin = await seedUserWithSession('bulk-admin');
      const { workspaceId } = await seedDiagram(admin.cookies, 'bulk-admin');

      const response = await app.inject({
        method: 'POST',
        url: `/workspaces/${workspaceId}/bundles`,
        cookies: admin.cookies,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('queued');
    });

    it('a non-admin (editor) role is rejected with 403', async () => {
      const admin = await seedUserWithSession('bulk-owner-2');
      const { workspaceId } = await seedDiagram(admin.cookies, 'bulk-editor');
      const editor = await seedUserWithSession('bulk-editor-actor');
      await db
        .insert(schema.workspaceMembers)
        .values({ workspaceId, userId: editor.user.id, role: 'editor' });

      const response = await app.inject({
        method: 'POST',
        url: `/workspaces/${workspaceId}/bundles`,
        cookies: editor.cookies,
      });

      expect(response.statusCode).toBe(403);
    });
  });
});
