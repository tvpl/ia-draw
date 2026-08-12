// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).
//
// The compaction tests use a real pg-boss instance (T28's fromPglite adapter) over the SAME
// PGlite database the rest of the test uses — real job persistence and dispatch, not a mock.
// Storage is an in-memory fake StorageClient (no real MinIO in this sandbox, T27's documented
// limitation) — this file's own logic (scene materialization, threshold math, snapshot rows)
// is what's under test, not MinIO's behavior.
import { randomUUID } from 'node:crypto';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { fromPglite } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../core/config.js';
import { buildServer } from '../../core/server.js';
import { createLocalAccount } from '../auth/accounts.js';
import { SESSION_COOKIE_NAME } from '../auth/cookie.js';
import { registerAuthModule } from '../auth/routes.js';
import { createSession } from '../auth/session.js';
import { registerDiagramSyncModule } from '../diagram-sync/routes.js';
import { type JobQueue, startJobs } from '../jobs/index.js';
import { EXPORT_BUCKET } from '../storage/index.js';
import type { StorageClient } from '../storage/signedUrl.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { registerCompactionJob } from './compaction.js';
import { registerSnapshotModule } from './routes.js';

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

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`waitUntil: condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('snapshot module — on-demand creation (T30, VER-01)', () => {
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
    storage = createFakeStorage();
    registerSnapshotModule(app, { db, storage });
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
      payload: { name: `Snap WS ${slug}`, slug: `snap-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id as string;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Snap Project ${slug}` },
    });
    const projectId = createProject.json().project.id as string;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Snap Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id as string };
  }

  async function submitOperation(
    cookies: Record<string, string>,
    diagramId: string,
    actorId: string,
    elementId: string,
    version: number,
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
            element: { id: elementId, type: 'rectangle', version, versionNonce: version },
            version,
            versionNonce: version,
          },
        ],
      },
    });
  }

  it('a named snapshot created on demand reflects the reconstituted scene correctly', async () => {
    const owner = await seedUserWithSession('snap-happy');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'happy');

    const op1 = await submitOperation(owner.cookies, diagramId, owner.user.id, 'el-1', 1);
    expect(op1.statusCode).toBe(200);
    const op2 = await submitOperation(owner.cookies, diagramId, owner.user.id, 'el-2', 1);
    expect(op2.statusCode).toBe(200);

    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/snapshots`,
      cookies: owner.cookies,
      payload: { name: 'my checkpoint' },
    });

    expect(response.statusCode).toBe(201);
    const { snapshot } = response.json();
    expect(snapshot.kind).toBe('named');
    expect(snapshot.name).toBe('my checkpoint');
    expect(snapshot.revision).toBe(2);
    expect(snapshot.immutable).toBe(false);

    const stored = storage.objects.get(`${EXPORT_BUCKET}/${snapshot.sceneJsonKey}`);
    expect(stored).toBeDefined();
    const storedScene = JSON.parse(stored as string) as Array<{ id: string }>;
    expect(storedScene.map((el) => el.id).sort()).toEqual(['el-1', 'el-2']);

    // Checksum matches the exact stored bytes (not a placeholder value).
    const crypto = await import('node:crypto');
    const expectedChecksum = `sha256:${crypto.createHash('sha256').update(stored as string).digest('hex')}`;
    expect(snapshot.checksum).toBe(expectedChecksum);
  });

  it('GET /diagrams/:id/snapshots lists created snapshots newest-revision first', async () => {
    const owner = await seedUserWithSession('snap-list');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'list');
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'el-1', 1);

    const first = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/snapshots`,
      cookies: owner.cookies,
      payload: { name: 'first' },
    });
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'el-2', 1);
    const second = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/snapshots`,
      cookies: owner.cookies,
      payload: { name: 'second' },
    });

    const listResponse = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/snapshots`,
      cookies: owner.cookies,
    });

    expect(listResponse.statusCode).toBe(200);
    const { snapshots } = listResponse.json();
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].id).toBe(second.json().snapshot.id);
    expect(snapshots[1].id).toBe(first.json().snapshot.id);
  });

  it('a reviewer receives 403 creating a snapshot (diagram:mutate required)', async () => {
    const owner = await seedUserWithSession('snap-rbac-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'rbac');
    const reviewer = await seedUserWithSession('snap-rbac-reviewer');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: reviewer.user.id, role: 'reviewer' });

    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/snapshots`,
      cookies: reviewer.cookies,
    });

    expect(response.statusCode).toBe(403);
  });

  it('a non-member receives 404, never 403, on a diagram outside their workspace (IDOR)', async () => {
    const owner = await seedUserWithSession('snap-idor-owner');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'idor');
    const outsider = await seedUserWithSession('snap-idor-outsider');

    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/snapshots`,
      cookies: outsider.cookies,
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('threshold-based compaction (T30, VER-01)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let app: FastifyInstance;
  let storage: ReturnType<typeof createFakeStorage>;
  let jobs: JobQueue;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const config = loadConfig({ NODE_ENV: 'test' });
    // Real pg-boss over the SAME PGlite database (AD-006: jobs share the app's Postgres).
    jobs = await startJobs(config, { db: fromPglite(client), backend: 'pglite' });

    storage = createFakeStorage();
    await registerCompactionJob(jobs, db, storage);

    app = buildServer(config);
    await registerAuthModule(app, { db, config });
    registerWorkspaceModule(app, { db });
    // A deliberately low operation threshold — documented per T30's "Done when": the test
    // simulates the real 100-operation threshold with a much smaller one instead of
    // submitting 100 real operations, so the suite stays fast without weakening the claim
    // that a threshold crossing triggers compaction.
    registerDiagramSyncModule(app, {
      db,
      jobs,
      compactionThresholds: { maxOperations: 3, maxAgeMs: 10 * 60 * 1000, maxBytes: 10 * 1024 * 1024 },
    });
    registerSnapshotModule(app, { db, storage });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await jobs.stop({ graceful: false, timeout: 1000 });
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
      payload: { name: `Compact WS ${slug}`, slug: `compact-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id as string;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Compact Project ${slug}` },
    });
    const projectId = createProject.json().project.id as string;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Compact Diagram ${slug}` },
    });
    return { diagramId: createDiagram.json().diagram.id as string };
  }

  async function submitOperation(
    cookies: Record<string, string>,
    diagramId: string,
    actorId: string,
    elementId: string,
    version: number,
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
            element: { id: elementId, type: 'rectangle', version, versionNonce: version },
            version,
            versionNonce: version,
          },
        ],
      },
    });
  }

  it('accumulating past the (lowered) operation threshold triggers automatic compaction without interrupting editing', async () => {
    const owner = await seedUserWithSession('compact-happy');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'happy');

    // Threshold is maxOperations: 3 — the 3rd batch crosses it and enqueues compaction.
    for (let i = 1; i <= 3; i++) {
      const response = await submitOperation(owner.cookies, diagramId, owner.user.id, `el-${i}`, 1);
      // Every batch ack's promptly regardless of compaction — the trigger only enqueues,
      // it never compacts inline (VER-01: "sem interromper a edição").
      expect(response.statusCode).toBe(200);
    }

    await waitUntil(async () => {
      const rows = await db.select().from(schema.diagramSnapshots);
      return rows.length > 0;
    }, 8000);

    const rows = await db.select().from(schema.diagramSnapshots);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'auto', diagramId, revision: 3 });

    const stored = storage.objects.get(`${EXPORT_BUCKET}/${rows[0]?.sceneJsonKey}`);
    expect(stored).toBeDefined();
    const storedScene = JSON.parse(stored as string) as Array<{ id: string }>;
    expect(storedScene).toHaveLength(3);
  });

  it('a diagram that never crosses the threshold accumulates no automatic snapshot', async () => {
    const owner = await seedUserWithSession('compact-under');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'under');

    await submitOperation(owner.cookies, diagramId, owner.user.id, 'el-1', 1);
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'el-2', 1);

    // Give any (incorrectly) enqueued job a chance to run before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const rows = await db.select().from(schema.diagramSnapshots);
    const forThisDiagram = rows.filter((row) => row.diagramId === diagramId);
    expect(forThisDiagram).toHaveLength(0);
  });
});
