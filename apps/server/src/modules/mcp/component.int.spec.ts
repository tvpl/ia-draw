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
import { registerLibraryModule } from '../library/routes.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { registerMcpModule } from './routes.js';

const library = LIBRARY_MANIFEST.items;

describe('GET /diagrams/:id/components/:stableKey (MCP-01, MCP-02, MCP-03, MCP-04, MCP-05)', () => {
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
    registerLibraryModule(app, { db });
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
      payload: { name: `Comp WS ${slug}`, slug: `comp-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id as string;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Comp Project ${slug}` },
    });
    const projectId = createProject.json().project.id as string;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Comp Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id as string };
  }

  async function mintMcpToken(
    cookies: Record<string, string>,
    workspaceId: string,
  ): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/mcp-tokens`,
      cookies,
      payload: { role: 'editor', label: `token-${Date.now()}` },
    });
    return response.json().token as string;
  }

  const testIr: IrDocument = {
    version: 'v1',
    kind: 'microservices',
    nodes: [
      { id: 'n1', label: 'Web server', componentKey: 'generic.compute.server' },
      { id: 'n2', label: 'Database' },
    ],
    containers: [],
    edges: [
      { from: 'n1', to: 'n2', semantics: { mode: 'sync', direction: 'oneway', label: 'reads' } },
    ],
  };

  async function seedSceneWithComponentMetadata(
    cookies: Record<string, string>,
    actorId: string,
    diagramId: string,
  ) {
    const scene = await compile(testIr, library, { seed: 11 });
    const batchResponse = await app.inject({
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
    expect(batchResponse.statusCode).toBe(200);

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: `/diagrams/${diagramId}/elements/n1/metadata`,
      cookies,
      payload: { metadataJson: { componentKey: 'generic.compute.server' } },
    });
    expect(patchResponse.statusCode).toBe(200);
  }

  it('a matching component returns its metadata plus correct inbound/outbound relations', async () => {
    const owner = await seedUserWithSession('component-happy-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'happy');
    await seedSceneWithComponentMetadata(owner.cookies, owner.user.id, diagramId);
    const token = await mintMcpToken(owner.cookies, workspaceId);

    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/components/generic.compute.server`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.metadata).toHaveLength(1);
    expect(body.metadata[0]).toMatchObject({ elementId: 'n1' });
    expect(body.outbound).toHaveLength(1);
    expect(body.outbound[0]).toMatchObject({ from: 'n1', to: 'n2' });
    expect(body.inbound).toEqual([]);
  });

  it('a stableKey with no matching element returns 404', async () => {
    const owner = await seedUserWithSession('component-missing-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'missing');
    await seedSceneWithComponentMetadata(owner.cookies, owner.user.id, diagramId);
    const token = await mintMcpToken(owner.cookies, workspaceId);

    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/components/does.not.exist`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it('a token scoped to a different workspace is denied with 404', async () => {
    const owner = await seedUserWithSession('component-cross-owner');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'cross');
    await seedSceneWithComponentMetadata(owner.cookies, owner.user.id, diagramId);

    const otherOwner = await seedUserWithSession('component-cross-other-owner');
    const otherWorkspace = await seedDiagramAs(otherOwner.cookies, 'cross-other');
    const outsiderToken = await mintMcpToken(otherOwner.cookies, otherWorkspace.workspaceId);

    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/components/generic.compute.server`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it('MCP-01/02/03 read routes agree on the same diagram: list, ir, and component all resolve consistently', async () => {
    const owner = await seedUserWithSession('component-together-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'together');
    await seedSceneWithComponentMetadata(owner.cookies, owner.user.id, diagramId);
    const token = await mintMcpToken(owner.cookies, workspaceId);
    const headers = { authorization: `Bearer ${token}` };

    const listResponse = await app.inject({
      method: 'GET',
      url: `/workspaces/${workspaceId}/diagrams`,
      headers,
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().items.map((d: { id: string }) => d.id)).toContain(diagramId);

    const irResponse = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/ir`,
      headers,
    });
    expect(irResponse.statusCode).toBe(200);
    const irBody = irResponse.json();
    expect(irBody.nodes.find((n: { id: string }) => n.id === 'n1')?.componentKey).toBe(
      'generic.compute.server',
    );

    const componentResponse = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/components/generic.compute.server`,
      headers,
    });
    expect(componentResponse.statusCode).toBe(200);
    expect(componentResponse.json().metadata[0].elementId).toBe('n1');
  });
});
