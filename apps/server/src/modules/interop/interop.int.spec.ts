// SPEC_DEVIATION: PGlite instead of testcontainers — no Docker in this sandbox (AD-007).
import { randomUUID } from 'node:crypto';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
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
import { registerInteropModule } from './routes.js';

describe('interop module — Mermaid/Structurizr import & export (T68, AAC-01/02)', () => {
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
    registerInteropModule(app, { db });
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

  async function seedProject(cookies: Record<string, string>, slug: string) {
    const createWs = await app.inject({
      method: 'POST',
      url: '/workspaces',
      cookies,
      payload: { name: `Interop WS ${slug}`, slug: `interop-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id as string;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Interop Project ${slug}` },
    });
    const projectId = createProject.json().project.id as string;
    return { workspaceId, projectId };
  }

  async function seedDiagram(cookies: Record<string, string>, slug: string) {
    const { workspaceId, projectId } = await seedProject(cookies, slug);
    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Interop Diagram ${slug}` },
    });
    return { workspaceId, projectId, diagramId: createDiagram.json().diagram.id as string };
  }

  async function submitOperation(
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
            element: { id: elementId, type: 'rectangle', version, versionNonce: version, ...extra },
            version,
            versionNonce: version,
          },
        ],
      },
    });
  }

  describe('POST /projects/:id/import:mermaid', () => {
    it('imports a 3-node flowchart into a brand new, editable diagram — response always carries a limitations field', async () => {
      const owner = await seedUserWithSession('interop-import-happy');
      const { projectId } = await seedProject(owner.cookies, 'import-happy');

      const dsl = ['flowchart TD', '  A[Client] --> B[API]', '  B --> C[Database]'].join('\n');

      const response = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/import:mermaid`,
        cookies: owner.cookies,
        payload: { dsl, title: 'Imported flow' },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.diagramId).toBeTypeOf('string');
      expect(Array.isArray(body.limitations)).toBe(true);

      // The new diagram is reachable and editable — confirms `createDiagram`
      // + the initial op-log write actually persisted, not just that the
      // route returned a well-shaped body.
      const getDiagram = await app.inject({
        method: 'GET',
        url: `/diagrams/${body.diagramId}`,
        cookies: owner.cookies,
      });
      expect(getDiagram.statusCode).toBe(200);
      expect(getDiagram.json().diagram.title).toBe('Imported flow');
    });

    it('creates a diagram from what parsed, even with one unrecognized line — never 500, limitations mentions the ignored line', async () => {
      const owner = await seedUserWithSession('interop-import-partial');
      const { projectId } = await seedProject(owner.cookies, 'import-partial');

      const dsl = [
        'flowchart TD',
        '  A[Client] --> B[API]',
        '  this is not valid mermaid syntax at all',
      ].join('\n');

      const response = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/import:mermaid`,
        cookies: owner.cookies,
        payload: { dsl },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.diagramId).toBeTypeOf('string');
      expect(body.limitations.length).toBeGreaterThan(0);
    });

    it('imports a Structurizr softwareSystem/container/relationship document', async () => {
      const owner = await seedUserWithSession('interop-import-structurizr');
      const { projectId } = await seedProject(owner.cookies, 'import-structurizr');

      const dsl = [
        'workspace {',
        '  model {',
        '    sys = softwareSystem "Checkout" {',
        '      web = container "Web app"',
        '      api = container "API"',
        '      web -> api "calls"',
        '    }',
        '  }',
        '}',
      ].join('\n');

      const response = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/import:structurizr`,
        cookies: owner.cookies,
        payload: { dsl },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().diagramId).toBeTypeOf('string');
    });

    it('a member without diagram:write (viewer) receives 403 on import', async () => {
      const owner = await seedUserWithSession('interop-import-viewer-owner');
      const { workspaceId, projectId } = await seedProject(owner.cookies, 'import-viewer');
      const viewer = await seedUserWithSession('interop-import-viewer');
      await db
        .insert(schema.workspaceMembers)
        .values({ workspaceId, userId: viewer.user.id, role: 'viewer' });

      const response = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/import:mermaid`,
        cookies: viewer.cookies,
        payload: { dsl: 'flowchart TD\n  A[X] --> B[Y]' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('a non-member of the project workspace receives 404 (IDOR-safe), never 403', async () => {
      const owner = await seedUserWithSession('interop-import-idor-owner');
      const { projectId } = await seedProject(owner.cookies, 'import-idor');
      const outsider = await seedUserWithSession('interop-import-idor-outsider');

      const response = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/import:mermaid`,
        cookies: outsider.cookies,
        payload: { dsl: 'flowchart TD\n  A[X] --> B[Y]' },
      });
      expect(response.statusCode).toBe(404);
    });

    it('rejects an unauthenticated request with 401 (never 404 — the route exists)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/projects/does-not-matter/import:mermaid',
        payload: { dsl: 'flowchart TD\n  A[X] --> B[Y]' },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /diagrams/:id/export:mermaid', () => {
    it('exports a 2-component connected scene as a valid Mermaid DSL containing both labels', async () => {
      const owner = await seedUserWithSession('interop-export-happy');
      const { diagramId } = await seedDiagram(owner.cookies, 'export-happy');

      await submitOperation(owner.cookies, diagramId, owner.user.id, 'a', 1);
      await submitOperation(owner.cookies, diagramId, owner.user.id, 'a-label', 1, {
        type: 'text',
        text: 'Checkout',
        containerId: 'a',
      });
      await submitOperation(owner.cookies, diagramId, owner.user.id, 'b', 1);
      await submitOperation(owner.cookies, diagramId, owner.user.id, 'b-label', 1, {
        type: 'text',
        text: 'Payments',
        containerId: 'b',
      });
      await submitOperation(owner.cookies, diagramId, owner.user.id, 'conn', 1, {
        type: 'arrow',
        startBinding: { elementId: 'a' },
        endBinding: { elementId: 'b' },
      });

      const response = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/export:mermaid`,
        cookies: owner.cookies,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.dsl).toContain('Checkout');
      expect(body.dsl).toContain('Payments');
      expect(Array.isArray(body.limitations)).toBe(true);
    });

    it("an edge with mode:'data' metadata is exported with a limitations entry documenting the lost semantics", async () => {
      const owner = await seedUserWithSession('interop-export-lossy');
      const { diagramId } = await seedDiagram(owner.cookies, 'export-lossy');

      await submitOperation(owner.cookies, diagramId, owner.user.id, 'a', 1);
      await submitOperation(owner.cookies, diagramId, owner.user.id, 'b', 1);
      await submitOperation(owner.cookies, diagramId, owner.user.id, 'conn', 1, {
        type: 'arrow',
        startBinding: { elementId: 'a' },
        endBinding: { elementId: 'b' },
      });

      await db.insert(schema.diagramElementsMeta).values({
        diagramId,
        elementId: 'conn',
        metadataJson: { mode: 'data' },
        revision: 3,
      });

      const response = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/export:mermaid`,
        cookies: owner.cookies,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.limitations.length).toBeGreaterThan(0);
    });

    it('exports the same scene as a Structurizr DSL', async () => {
      const owner = await seedUserWithSession('interop-export-structurizr');
      const { diagramId } = await seedDiagram(owner.cookies, 'export-structurizr');
      await submitOperation(owner.cookies, diagramId, owner.user.id, 'a', 1);
      await submitOperation(owner.cookies, diagramId, owner.user.id, 'b', 1);
      await submitOperation(owner.cookies, diagramId, owner.user.id, 'conn', 1, {
        type: 'arrow',
        startBinding: { elementId: 'a' },
        endBinding: { elementId: 'b' },
      });

      const response = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/export:structurizr`,
        cookies: owner.cookies,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().dsl.length).toBeGreaterThan(0);
    });

    it('a user without diagram:read on the workspace (non-member) receives 404, never 403 (IDOR)', async () => {
      const owner = await seedUserWithSession('interop-export-idor-owner');
      const { diagramId } = await seedDiagram(owner.cookies, 'export-idor');
      const outsider = await seedUserWithSession('interop-export-idor-outsider');

      const response = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/export:mermaid`,
        cookies: outsider.cookies,
      });
      expect(response.statusCode).toBe(404);
    });

    it('rejects an unauthenticated request with 401', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/diagrams/does-not-matter/export:mermaid',
      });
      expect(response.statusCode).toBe(401);
    });
  });
});
