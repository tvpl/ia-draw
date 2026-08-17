// SPEC_DEVIATION: PGlite instead of testcontainers — no Docker in this sandbox (AD-007).
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
import { registerLibraryModule } from '../library/routes.js';
import { EXPORT_BUCKET } from '../storage/index.js';
import type { StorageClient } from '../storage/signedUrl.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { registerDocgenModule } from './routes.js';

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

describe('docgen module — spec generation and listing (T62)', () => {
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
    registerLibraryModule(app, { db });
    storage = createFakeStorage();
    registerDocgenModule(app, { db, storage });
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
      payload: { name: `Docgen WS ${slug}`, slug: `docgen-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id as string;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Docgen Project ${slug}` },
    });
    const projectId = createProject.json().project.id as string;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Docgen Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id as string };
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
        clientMutationId: crypto.randomUUID(),
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

  it('generates a spec citing the 3 real elementIds across distinct sections, DOC-01', async () => {
    const owner = await seedUserWithSession('docgen-happy');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'happy');

    await submitOperation(owner.cookies, diagramId, owner.user.id, 'api', 1);
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'db', 1);
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'ui', 1);
    // Two labeled edges (arrows with resolved bindings).
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'edge1', 1, {
      type: 'arrow',
      startBinding: { elementId: 'ui' },
      endBinding: { elementId: 'api' },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/specs:generate`,
      cookies: owner.cookies,
    });
    expect(response.statusCode).toBe(201);
    const { spec } = response.json();
    expect(spec.status).toBe('current');
    expect(spec.version).toBe(1);
    // living-docs (LDC-12): every route attaches a signed read URL for the Markdown object —
    // additive field, computed from the same `markdownKey`/bucket the storage object was written
    // under.
    expect(spec.markdownUrl).toBe(`https://fake-storage.test/${EXPORT_BUCKET}/${spec.markdownKey}`);

    const markdown = storage.objects.get(`${EXPORT_BUCKET}/${spec.markdownKey}`);
    expect(markdown).toBeDefined();
    for (const id of ['api', 'db', 'ui']) {
      expect(markdown).toContain(id);
    }
  });

  it('a component with no semantic metadata shows the literal "não especificado" placeholder, never invented', async () => {
    const owner = await seedUserWithSession('docgen-nospec');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'nospec');
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'lonely', 1);

    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/specs:generate`,
      cookies: owner.cookies,
    });
    const { spec } = response.json();
    const markdown = storage.objects.get(`${EXPORT_BUCKET}/${spec.markdownKey}`);
    expect(markdown).toContain('não especificado');
  });

  it('GET /diagrams/:id/specs returns the latest as current and prior versions as superseded', async () => {
    const owner = await seedUserWithSession('docgen-versions');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'versions');
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'el-1', 1);

    const first = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/specs:generate`,
      cookies: owner.cookies,
    });
    expect(first.statusCode).toBe(201);

    await submitOperation(owner.cookies, diagramId, owner.user.id, 'el-2', 1);
    const second = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/specs:generate`,
      cookies: owner.cookies,
    });
    expect(second.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/specs`,
      cookies: owner.cookies,
    });
    expect(list.statusCode).toBe(200);
    const { specs } = list.json();
    expect(specs).toHaveLength(2);
    expect(specs[0].version).toBe(2);
    expect(specs[0].status).toBe('current');
    expect(specs[1].version).toBe(1);
    expect(specs[1].status).toBe('superseded');
    // living-docs (LDC-12): the list route attaches `markdownUrl` to every row, not just the
    // single-spec `:generate`/`:regenerate-section` responses.
    for (const row of specs) {
      expect(row.markdownUrl).toBe(`https://fake-storage.test/${EXPORT_BUCKET}/${row.markdownKey}`);
    }
  });

  it('reviewer gets 403 on :generate but 200 on GET /specs', async () => {
    const owner = await seedUserWithSession('docgen-rbac-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'rbac');
    const reviewer = await seedUserWithSession('docgen-rbac-reviewer');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: reviewer.user.id, role: 'reviewer' });

    const generateResponse = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/specs:generate`,
      cookies: reviewer.cookies,
    });
    expect(generateResponse.statusCode).toBe(403);

    const getResponse = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/specs`,
      cookies: reviewer.cookies,
    });
    expect(getResponse.statusCode).toBe(200);
  });

  it('spec_documents.sourceRevision matches the exact live revision at generation time', async () => {
    const owner = await seedUserWithSession('docgen-revision');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'revision');
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'el-1', 1);
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'el-2', 1);

    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/specs:generate`,
      cookies: owner.cookies,
    });
    const { spec } = response.json();
    expect(spec.sourceRevision).toBe(2);
  });

  it('a non-member receives 404, never 403, on a diagram outside their workspace (IDOR)', async () => {
    const owner = await seedUserWithSession('docgen-idor-owner');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'idor');
    const outsider = await seedUserWithSession('docgen-idor-outsider');

    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/specs`,
      cookies: outsider.cookies,
    });
    expect(response.statusCode).toBe(404);
  });
});
