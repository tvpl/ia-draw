// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).

import { randomUUID } from 'node:crypto';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER, seedGlobalLibrary } from '@arch-canvas/database';
import { LIBRARY_MANIFEST } from '@arch-canvas/library-content';
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
import { registerDiagramSyncModule } from '../diagram-sync/routes.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { registerLibraryModule } from './routes.js';

describe('library module — listing, semantic metadata, inventory export (T39, LIB-02/03/04)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let app: FastifyInstance;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });
    await seedGlobalLibrary(db);

    const config = loadConfig({ NODE_ENV: 'test' });
    app = buildServer(config);
    await registerAuthModule(app, { db, config });
    registerWorkspaceModule(app, { db });
    registerDiagramSyncModule(app, { db });
    registerLibraryModule(app, { db });
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
      payload: { name: `Lib WS ${slug}`, slug: `lib-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id as string;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Lib Project ${slug}` },
    });
    const projectId = createProject.json().project.id as string;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Lib Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id as string };
  }

  async function createSceneElement(
    cookies: Record<string, string>,
    actorId: string,
    diagramId: string,
    elementId: string,
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
            elementId,
            kind: 'upsert',
            element: { id: elementId, type: 'rectangle', version: 1, versionNonce: 1 },
            version: 1,
            versionNonce: 1,
          },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
  }

  function getMetadata(cookies: Record<string, string>, diagramId: string, elementId: string) {
    return app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/elements/${elementId}/metadata`,
      cookies,
    });
  }

  function patchMetadata(
    cookies: Record<string, string>,
    diagramId: string,
    elementId: string,
    body: Record<string, unknown>,
  ) {
    return app.inject({
      method: 'PATCH',
      url: `/diagrams/${diagramId}/elements/${elementId}/metadata`,
      cookies,
      payload: body,
    });
  }

  describe('GET /libraries', () => {
    it('always includes the seeded global library, unscoped', async () => {
      const owner = await seedUserWithSession('lib-list-global');
      const response = await app.inject({
        method: 'GET',
        url: '/libraries',
        cookies: owner.cookies,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      const globalLib = body.items.find(
        (item: { name: string }) => item.name === LIBRARY_MANIFEST.name,
      );
      expect(globalLib).toBeDefined();
      expect(globalLib.workspaceId).toBeNull();
    });

    it('rejects an unauthenticated request with 401', async () => {
      const response = await app.inject({ method: 'GET', url: '/libraries' });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('semantic metadata read/write', () => {
    it('persists metadata linked to elementId and the diagram current revision, readable back exactly', async () => {
      const owner = await seedUserWithSession('lib-meta-happy');
      const { diagramId } = await seedDiagramAs(owner.cookies, 'meta-happy');
      await createSceneElement(owner.cookies, owner.user.id, diagramId, 'el-1');

      const patchResponse = await patchMetadata(owner.cookies, diagramId, 'el-1', {
        semanticType: 'aws.ec2',
        metadataJson: { tier: 'compute', notes: 'primary app server' },
      });
      expect(patchResponse.statusCode).toBe(200);
      const patched = patchResponse.json().metadata;
      expect(patched).toMatchObject({
        diagramId,
        elementId: 'el-1',
        semanticType: 'aws.ec2',
        metadataJson: { tier: 'compute', notes: 'primary app server' },
        revision: 1, // the one operations:batch call above committed sequence 1
      });

      const getResponse = await getMetadata(owner.cookies, diagramId, 'el-1');
      expect(getResponse.statusCode).toBe(200);
      expect(getResponse.json().metadata).toMatchObject({
        elementId: 'el-1',
        semanticType: 'aws.ec2',
        metadataJson: { tier: 'compute', notes: 'primary app server' },
        revision: 1,
      });
    });

    it('a second PATCH for the same elementId updates the row in place (idempotent by elementId)', async () => {
      const owner = await seedUserWithSession('lib-meta-idempotent');
      const { diagramId } = await seedDiagramAs(owner.cookies, 'meta-idem');
      await createSceneElement(owner.cookies, owner.user.id, diagramId, 'el-1');

      await patchMetadata(owner.cookies, diagramId, 'el-1', {
        semanticType: 'generic.compute.server',
      });
      const second = await patchMetadata(owner.cookies, diagramId, 'el-1', {
        semanticType: 'aws.lambda',
      });
      expect(second.statusCode).toBe(200);

      const rows = await db
        .select()
        .from(schema.diagramElementsMeta)
        .where(
          and(
            eq(schema.diagramElementsMeta.diagramId, diagramId),
            eq(schema.diagramElementsMeta.elementId, 'el-1'),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.semanticType).toBe('aws.lambda');
    });

    it('GET returns 404 for an element with no metadata set yet', async () => {
      const owner = await seedUserWithSession('lib-meta-missing');
      const { diagramId } = await seedDiagramAs(owner.cookies, 'meta-missing');
      const response = await getMetadata(owner.cookies, diagramId, 'never-set');
      expect(response.statusCode).toBe(404);
    });

    it('a reviewer receives 403 on PATCH — diagram:write, not diagram:mutate, still denies reviewer', async () => {
      const owner = await seedUserWithSession('lib-meta-reviewer-owner');
      const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'meta-reviewer');
      const reviewer = await seedUserWithSession('lib-meta-reviewer');
      await db
        .insert(schema.workspaceMembers)
        .values({ workspaceId, userId: reviewer.user.id, role: 'reviewer' });

      const response = await patchMetadata(reviewer.cookies, diagramId, 'el-1', {
        semanticType: 'aws.ec2',
      });
      expect(response.statusCode).toBe(403);
    });

    it('a reviewer CAN still read metadata (diagram:read is granted)', async () => {
      const owner = await seedUserWithSession('lib-meta-reviewer-read-owner');
      const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'meta-reviewer-read');
      await createSceneElement(owner.cookies, owner.user.id, diagramId, 'el-1');
      await patchMetadata(owner.cookies, diagramId, 'el-1', { semanticType: 'aws.ec2' });

      const reviewer = await seedUserWithSession('lib-meta-reviewer-read');
      await db
        .insert(schema.workspaceMembers)
        .values({ workspaceId, userId: reviewer.user.id, role: 'reviewer' });

      const response = await getMetadata(reviewer.cookies, diagramId, 'el-1');
      expect(response.statusCode).toBe(200);
    });

    it('a non-member receives 404, never 403, on a diagram outside their workspace (IDOR)', async () => {
      const owner = await seedUserWithSession('lib-meta-idor-owner');
      const { diagramId } = await seedDiagramAs(owner.cookies, 'meta-idor');
      const outsider = await seedUserWithSession('lib-meta-idor-outsider');

      const getResp = await getMetadata(outsider.cookies, diagramId, 'el-1');
      expect(getResp.statusCode).toBe(404);

      const patchResp = await patchMetadata(outsider.cookies, diagramId, 'el-1', {
        semanticType: 'aws.ec2',
      });
      expect(patchResp.statusCode).toBe(404);
    });
  });

  describe('inventory export', () => {
    it('CSV and JSON exports carry the same persisted content in different formats', async () => {
      const owner = await seedUserWithSession('lib-inventory');
      const { diagramId } = await seedDiagramAs(owner.cookies, 'inventory');
      await createSceneElement(owner.cookies, owner.user.id, diagramId, 'el-1');
      await createSceneElement(owner.cookies, owner.user.id, diagramId, 'el-2');
      await patchMetadata(owner.cookies, diagramId, 'el-1', {
        semanticType: 'aws.ec2',
        metadataJson: { tier: 'compute' },
      });
      await patchMetadata(owner.cookies, diagramId, 'el-2', {
        semanticType: 'aws.rds',
        metadataJson: { tier: 'database' },
      });

      const jsonResponse = await app.inject({
        method: 'GET',
        url: `/diagrams/${diagramId}/inventory?format=json`,
        cookies: owner.cookies,
      });
      expect(jsonResponse.statusCode).toBe(200);
      const jsonItems: Array<{ elementId: string; elementType: string; semanticType: string }> =
        jsonResponse.json().items;
      expect(jsonItems).toHaveLength(2);
      const byId = new Map(jsonItems.map((item) => [item.elementId, item]));
      expect(byId.get('el-1')).toMatchObject({ elementType: 'rectangle', semanticType: 'aws.ec2' });
      expect(byId.get('el-2')).toMatchObject({ elementType: 'rectangle', semanticType: 'aws.rds' });

      const csvResponse = await app.inject({
        method: 'GET',
        url: `/diagrams/${diagramId}/inventory?format=csv`,
        cookies: owner.cookies,
      });
      expect(csvResponse.statusCode).toBe(200);
      expect(csvResponse.headers['content-type']).toContain('text/csv');
      const csvLines = csvResponse.body.trim().split('\n');
      expect(csvLines[0]).toBe('elementId,elementType,semanticType,revision,metadataJson');
      expect(csvLines).toHaveLength(3); // header + 2 rows
      expect(csvResponse.body).toContain('el-1,rectangle,aws.ec2');
      expect(csvResponse.body).toContain('el-2,rectangle,aws.rds');
    });

    it('a non-member receives 404 on inventory export (IDOR)', async () => {
      const owner = await seedUserWithSession('lib-inventory-idor-owner');
      const { diagramId } = await seedDiagramAs(owner.cookies, 'inventory-idor');
      const outsider = await seedUserWithSession('lib-inventory-idor-outsider');

      const response = await app.inject({
        method: 'GET',
        url: `/diagrams/${diagramId}/inventory`,
        cookies: outsider.cookies,
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
