// SPEC_DEVIATION: PGlite instead of testcontainers — no Docker in this sandbox (AD-007).
import { randomUUID } from 'node:crypto';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { compile, type IrDocument } from '@arch-canvas/diagram-ir';
import { LIBRARY_MANIFEST } from '@arch-canvas/library-content';
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
import { registerMcpModule } from './routes.js';

const library = LIBRARY_MANIFEST.items;

describe('GET /workspaces/:id/diagrams + GET /diagrams/:id/ir (MCP-01, MCP-02, MCP-04, MCP-05)', () => {
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
    registerMcpModule(app, { db });
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

  async function seedDiagramAs(cookies: Record<string, string>, slug: string) {
    const createWs = await app.inject({
      method: 'POST',
      url: '/workspaces',
      cookies,
      payload: { name: `IR WS ${slug}`, slug: `ir-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id as string;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `IR Project ${slug}` },
    });
    const projectId = createProject.json().project.id as string;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `IR Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id as string };
  }

  async function mintMcpToken(
    cookies: Record<string, string>,
    workspaceId: string,
    role: 'org_admin' | 'workspace_admin' | 'editor' | 'reviewer' | 'viewer' = 'editor',
  ): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/mcp-tokens`,
      cookies,
      payload: { role, label: `token-${Date.now()}` },
    });
    return response.json().token as string;
  }

  const testIr: IrDocument = {
    version: 'v1',
    kind: 'microservices',
    nodes: [
      { id: 'n1', label: 'Web server' },
      { id: 'n2', label: 'Database' },
    ],
    containers: [],
    edges: [
      { from: 'n1', to: 'n2', semantics: { mode: 'sync', direction: 'oneway', label: 'reads' } },
    ],
  };

  async function seedScene(cookies: Record<string, string>, actorId: string, diagramId: string) {
    const scene = await compile(testIr, library, { seed: 7 });
    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies,
      payload: {
        clientMutationId: randomUUID(),
        baseRevision: 0,
        actorId,
        deltas: scene.elements.map((element) => ({
          elementId: element.id,
          kind: 'upsert',
          element,
          version: element.version,
          versionNonce: element.versionNonce,
        })),
      },
    });
    expect(response.statusCode).toBe(200);
  }

  describe('GET /diagrams/:id/ir', () => {
    it('a token with read permission gets back the structured IrDocument, never a rendered image', async () => {
      const owner = await seedUserWithSession('ir-happy-owner');
      const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'happy');
      await seedScene(owner.cookies, owner.user.id, diagramId);
      const token = await mintMcpToken(owner.cookies, workspaceId);

      const response = await app.inject({
        method: 'GET',
        url: `/diagrams/${diagramId}/ir`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      // Structured diagram-ir/v1 document — MCP-02 literal: never just a rendered image.
      expect(body.version).toBe('v1');
      expect(body).not.toHaveProperty('image');
      expect(body).not.toHaveProperty('png');
      expect(new Set(body.nodes.map((n: { id: string }) => n.id))).toEqual(new Set(['n1', 'n2']));
      expect(body.edges).toHaveLength(1);
      expect(body.edges[0]).toMatchObject({ from: 'n1', to: 'n2' });
    });

    it('a token scoped to a different workspace is denied with 404, never revealing the diagram exists', async () => {
      const owner = await seedUserWithSession('ir-cross-owner');
      const { diagramId } = await seedDiagramAs(owner.cookies, 'cross');
      await seedScene(owner.cookies, owner.user.id, diagramId);

      const otherOwner = await seedUserWithSession('ir-cross-other-owner');
      const otherWorkspace = await seedDiagramAs(otherOwner.cookies, 'cross-other');
      const outsiderToken = await mintMcpToken(otherOwner.cookies, otherWorkspace.workspaceId);

      const response = await app.inject({
        method: 'GET',
        url: `/diagrams/${diagramId}/ir`,
        headers: { authorization: `Bearer ${outsiderToken}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('a non-existent diagram id also returns 404, indistinguishable from the denied case', async () => {
      const owner = await seedUserWithSession('ir-missing-owner');
      const { workspaceId } = await seedDiagramAs(owner.cookies, 'missing');
      const token = await mintMcpToken(owner.cookies, workspaceId);

      const response = await app.inject({
        method: 'GET',
        url: '/diagrams/00000000-0000-0000-0000-000000000000/ir',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('a missing Authorization header is denied with the same uniform 404', async () => {
      const owner = await seedUserWithSession('ir-noauth-owner');
      const { diagramId } = await seedDiagramAs(owner.cookies, 'noauth');
      await seedScene(owner.cookies, owner.user.id, diagramId);

      const response = await app.inject({ method: 'GET', url: `/diagrams/${diagramId}/ir` });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /workspaces/:id/diagrams', () => {
    it('lists every diagram across every project in the token workspace', async () => {
      const owner = await seedUserWithSession('list-happy-owner');
      const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'list-happy');
      const token = await mintMcpToken(owner.cookies, workspaceId);

      const response = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/diagrams`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const ids = response.json().items.map((diagram: { id: string }) => diagram.id);
      expect(ids).toContain(diagramId);
    });

    it('a token scoped to a different workspace is denied with 404', async () => {
      const owner = await seedUserWithSession('list-cross-owner');
      const { workspaceId } = await seedDiagramAs(owner.cookies, 'list-cross');

      const otherOwner = await seedUserWithSession('list-cross-other-owner');
      const otherWorkspace = await seedDiagramAs(otherOwner.cookies, 'list-cross-other');
      const outsiderToken = await mintMcpToken(otherOwner.cookies, otherWorkspace.workspaceId);

      const response = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/diagrams`,
        headers: { authorization: `Bearer ${outsiderToken}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
