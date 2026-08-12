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
import { parseMarkdownSections } from './regenerateSection.js';
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

describe('docgen module — single-section regeneration (T63, DOC-04)', () => {
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
      payload: { name: `Regen WS ${slug}`, slug: `regen-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id as string;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Regen Project ${slug}` },
    });
    const projectId = createProject.json().project.id as string;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Regen Diagram ${slug}` },
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

  it('regenerating one section leaves the other three byte-identical and never overwrites the prior storage object', async () => {
    const owner = await seedUserWithSession('docgen-regen');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'regen');
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'api', 1);
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'edge1', 1, {
      type: 'arrow',
      startBinding: { elementId: 'api' },
      endBinding: null,
    });

    const generate = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/specs:generate`,
      cookies: owner.cookies,
    });
    const baseSpec = generate.json().spec;
    const baseMarkdown = storage.objects.get(`${EXPORT_BUCKET}/${baseSpec.markdownKey}`);

    // Add a new component AND a fully-resolved edge referencing it, so the "Fluxos" section
    // actually changes on recompute (the base diagram's only arrow was dangling, so its base
    // flows section was "Nenhum fluxo mapeado.").
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'db', 1);
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'edge2', 1, {
      type: 'arrow',
      startBinding: { elementId: 'api' },
      endBinding: { elementId: 'db' },
    });

    const regenerate = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/specs/${baseSpec.version}:regenerate-section`,
      cookies: owner.cookies,
      payload: { section: 'flows' },
    });
    expect(regenerate.statusCode).toBe(201);
    const newSpec = regenerate.json().spec;
    expect(newSpec.version).toBe(baseSpec.version + 1);

    // Prior version's storage object is untouched.
    expect(storage.objects.get(`${EXPORT_BUCKET}/${baseSpec.markdownKey}`)).toBe(baseMarkdown);

    const newMarkdown = storage.objects.get(`${EXPORT_BUCKET}/${newSpec.markdownKey}`);
    expect(newMarkdown).toBeDefined();

    // Components/Overview/Decisões sections are byte-identical; only Fluxos was regenerated —
    // Overview's component count intentionally does NOT reflect the newly added 'db' element,
    // because Overview was not the section asked for.
    const baseSections = parseMarkdownSections(baseMarkdown as string);
    const newSections = parseMarkdownSections(newMarkdown as string);
    expect(newSections.components).toBe(baseSections.components);
    expect(newSections.overview).toBe(baseSections.overview);
    expect(newSections.decisions).toBe(baseSections.decisions);
    expect(newSections.flows).not.toBe(baseSections.flows);
  });

  it('regenerating an unknown section returns 400 with a clear error', async () => {
    const owner = await seedUserWithSession('docgen-badsection');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'badsection');
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'el-1', 1);

    const generate = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/specs:generate`,
      cookies: owner.cookies,
    });
    const baseSpec = generate.json().spec;

    const regenerate = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/specs/${baseSpec.version}:regenerate-section`,
      cookies: owner.cookies,
      payload: { section: 'not-a-real-section' },
    });
    expect(regenerate.statusCode).toBe(400);
  });

  it("regenerating a version bumps sourceRevision to the diagram's revision at regeneration time, which may have advanced", async () => {
    const owner = await seedUserWithSession('docgen-regen-revision');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'regen-revision');
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'el-1', 1);

    const generate = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/specs:generate`,
      cookies: owner.cookies,
    });
    const baseSpec = generate.json().spec;
    expect(baseSpec.sourceRevision).toBe(1);

    await submitOperation(owner.cookies, diagramId, owner.user.id, 'el-2', 1);

    const regenerate = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/specs/${baseSpec.version}:regenerate-section`,
      cookies: owner.cookies,
      payload: { section: 'overview' },
    });
    const newSpec = regenerate.json().spec;
    expect(newSpec.sourceRevision).toBe(2);
  });

  it('a reviewer receives 403 regenerating a section (diagram:mutate required)', async () => {
    const owner = await seedUserWithSession('docgen-regen-rbac-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'regen-rbac');
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'el-1', 1);
    const generate = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/specs:generate`,
      cookies: owner.cookies,
    });
    const baseSpec = generate.json().spec;

    const reviewer = await seedUserWithSession('docgen-regen-rbac-reviewer');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: reviewer.user.id, role: 'reviewer' });

    const regenerate = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/specs/${baseSpec.version}:regenerate-section`,
      cookies: reviewer.cookies,
      payload: { section: 'overview' },
    });
    expect(regenerate.statusCode).toBe(403);
  });

  it('regenerating a non-existent base version returns 404', async () => {
    const owner = await seedUserWithSession('docgen-regen-missing');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'regen-missing');
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'el-1', 1);

    const regenerate = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/specs/999:regenerate-section`,
      cookies: owner.cookies,
      payload: { section: 'overview' },
    });
    expect(regenerate.statusCode).toBe(404);
  });
});
