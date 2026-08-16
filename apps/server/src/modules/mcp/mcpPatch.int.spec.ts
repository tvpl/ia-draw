// SPEC_DEVIATION: PGlite instead of testcontainers — no Docker in this sandbox (AD-007).
// Storage is an in-memory fake StorageClient (no real MinIO in this sandbox, T27's documented
// limitation, mirrored from ai-engine/applyPatch.int.spec.ts).
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
import { registerSnapshotModule } from '../snapshot/routes.js';
import type { StorageClient } from '../storage/signedUrl.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { registerMcpModule } from './routes.js';

const library = LIBRARY_MANIFEST.items;

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

describe('POST /diagrams/:id/mcp-patch (MCP-07)', () => {
  let pgClient: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let storage: ReturnType<typeof createFakeStorage>;
  let writeApp: FastifyInstance;
  let readOnlyApp: FastifyInstance;

  beforeAll(async () => {
    pgClient = new PGlite();
    db = drizzle(pgClient, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });
    storage = createFakeStorage();

    const config = loadConfig({ NODE_ENV: 'test' });

    // MCP_WRITE_ENABLED=true at registration time (T14: read once, at server
    // boot — never a per-request check) — this app has the mcp-patch route.
    const previousFlag = process.env.MCP_WRITE_ENABLED;
    process.env.MCP_WRITE_ENABLED = 'true';
    writeApp = buildServer(config);
    await registerAuthModule(writeApp, { db, config });
    registerWorkspaceModule(writeApp, { db });
    registerDiagramSyncModule(writeApp, { db });
    registerSnapshotModule(writeApp, { db, storage });
    registerMcpModule(writeApp, { db, storage });
    await writeApp.ready();

    // Flag off (the default) — this app never registers the write route.
    process.env.MCP_WRITE_ENABLED = 'false';
    readOnlyApp = buildServer(config);
    await registerAuthModule(readOnlyApp, { db, config });
    registerWorkspaceModule(readOnlyApp, { db });
    registerDiagramSyncModule(readOnlyApp, { db });
    registerMcpModule(readOnlyApp, { db });
    await readOnlyApp.ready();

    if (previousFlag === undefined) {
      delete process.env.MCP_WRITE_ENABLED;
    } else {
      process.env.MCP_WRITE_ENABLED = previousFlag;
    }
  });

  afterAll(async () => {
    await writeApp.close();
    await readOnlyApp.close();
    await pgClient.close();
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

  async function seedDiagramAs(
    app: FastifyInstance,
    cookies: Record<string, string>,
    slug: string,
  ) {
    const createWs = await app.inject({
      method: 'POST',
      url: '/workspaces',
      cookies,
      payload: { name: `Patch WS ${slug}`, slug: `patch-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id as string;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Patch Project ${slug}` },
    });
    const projectId = createProject.json().project.id as string;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Patch Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id as string };
  }

  async function seedScene(
    app: FastifyInstance,
    cookies: Record<string, string>,
    actorId: string,
    diagramId: string,
  ) {
    const scene = await compile(testIr, library, { seed: 5 });
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
    return response.json().currentRevision as number;
  }

  async function mintMcpToken(
    app: FastifyInstance,
    cookies: Record<string, string>,
    workspaceId: string,
    role: 'org_admin' | 'workspace_admin' | 'editor' | 'reviewer' | 'viewer' = 'editor',
  ): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: `/workspaces/${workspaceId}/mcp-tokens`,
      cookies,
      payload: { role, label: `token-${Date.now()}-${Math.random()}` },
    });
    return response.json().token as string;
  }

  it('writes the metadata, creates a pre_ai snapshot, and returns the new revision', async () => {
    const owner = await seedUserWithSession('patch-happy-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(writeApp, owner.cookies, 'happy');
    const revision = await seedScene(writeApp, owner.cookies, owner.user.id, diagramId);
    const token = await mintMcpToken(writeApp, owner.cookies, workspaceId);

    const response = await writeApp.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/mcp-patch`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        sourceRevision: revision,
        op: {
          op: 'setMetadata',
          elementId: 'n1',
          metadata: { componentKey: 'generic.compute.server' },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(typeof body.snapshotId).toBe('string');
    expect(body.revision).toBe(revision);

    const irResponse = await writeApp.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/ir`,
      headers: { authorization: `Bearer ${token}` },
    });
    const irBody = irResponse.json();
    expect(irBody.nodes.find((n: { id: string }) => n.id === 'n1')?.componentKey).toBe(
      'generic.compute.server',
    );
  });

  it('a stale sourceRevision is rejected with 409, never silently applied', async () => {
    const owner = await seedUserWithSession('patch-stale-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(writeApp, owner.cookies, 'stale');
    const revision = await seedScene(writeApp, owner.cookies, owner.user.id, diagramId);
    const token = await mintMcpToken(writeApp, owner.cookies, workspaceId);

    const response = await writeApp.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/mcp-patch`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        sourceRevision: revision + 1,
        op: { op: 'setMetadata', elementId: 'n1', metadata: { componentKey: 'stale' } },
      },
    });

    expect(response.statusCode).toBe(409);
  });

  it('a token without diagram:mutate (viewer role) is denied with 404, never a partial write', async () => {
    const owner = await seedUserWithSession('patch-denied-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(writeApp, owner.cookies, 'denied');
    const revision = await seedScene(writeApp, owner.cookies, owner.user.id, diagramId);
    const viewerToken = await mintMcpToken(writeApp, owner.cookies, workspaceId, 'viewer');

    const response = await writeApp.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/mcp-patch`,
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: {
        sourceRevision: revision,
        op: { op: 'setMetadata', elementId: 'n1', metadata: { componentKey: 'should-not-land' } },
      },
    });

    expect(response.statusCode).toBe(404);

    const irResponse = await writeApp.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/ir`,
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(
      irResponse.json().nodes.find((n: { id: string }) => n.id === 'n1')?.componentKey,
    ).toBeUndefined();
  });

  it('with MCP_WRITE_ENABLED off, the route does not exist at all — a generic 404, not an existing-but-denied route', async () => {
    const owner = await seedUserWithSession('patch-flag-off-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(readOnlyApp, owner.cookies, 'flag-off');
    const revision = await seedScene(readOnlyApp, owner.cookies, owner.user.id, diagramId);
    const token = await mintMcpToken(readOnlyApp, owner.cookies, workspaceId);

    const response = await readOnlyApp.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/mcp-patch`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        sourceRevision: revision,
        op: { op: 'setMetadata', elementId: 'n1', metadata: { componentKey: 'unreachable' } },
      },
    });

    // Same problem+json shape either way (title: 'Not Found') as any
    // request-denied 404 in this module — by design (AUTH-04/MCP-05: never
    // reveal, by body or by status, whether a resource/route exists). What
    // this test actually proves is that a token with editor-level write
    // permission still gets 404 when the flag is off, i.e. the route is
    // gone, not merely denying this particular caller.
    expect(response.statusCode).toBe(404);
    expect(response.json().title).toBe('Not Found');
  });

  it('the pre_ai snapshot the write creates is reconstitutable as a real undo point', async () => {
    const owner = await seedUserWithSession('patch-undo-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(writeApp, owner.cookies, 'undo');
    const revision = await seedScene(writeApp, owner.cookies, owner.user.id, diagramId);
    const token = await mintMcpToken(writeApp, owner.cookies, workspaceId);

    const patchResponse = await writeApp.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/mcp-patch`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        sourceRevision: revision,
        op: {
          op: 'setMetadata',
          elementId: 'n1',
          metadata: { componentKey: 'generic.compute.server' },
        },
      },
    });
    expect(patchResponse.statusCode).toBe(200);
    const snapshotId = patchResponse.json().snapshotId as string;

    const restoreResponse = await writeApp.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/snapshots/${snapshotId}:restore`,
      cookies: owner.cookies,
      payload: {},
    });

    expect(restoreResponse.statusCode).toBe(200);
    expect(restoreResponse.json().restoredFromSnapshotId).toBe(snapshotId);
  });
});
