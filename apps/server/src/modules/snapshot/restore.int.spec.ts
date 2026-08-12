// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).
//
// Storage is an in-memory fake StorageClient (no real MinIO in this sandbox, T27's documented
// limitation) — this file's own logic (restore deltas, immutability, diff resolution) is what's
// under test, not MinIO's behavior.
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
import { registerSnapshotModule } from './routes.js';
import { createSnapshot } from './snapshots.js';

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

describe('snapshot restore + structural diff (T31, VER-02/03/04)', () => {
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
      payload: { name: `Restore WS ${slug}`, slug: `restore-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id as string;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Restore Project ${slug}` },
    });
    const projectId = createProject.json().project.id as string;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Restore Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id as string };
  }

  async function submitBatch(
    cookies: Record<string, string>,
    diagramId: string,
    actorId: string,
    deltas: Array<{ elementId: string; element: Record<string, unknown>; version: number }>,
    baseRevision: number,
  ) {
    return app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies,
      payload: {
        clientMutationId: randomUUID(),
        baseRevision,
        actorId,
        deltas: deltas.map((d) => ({
          elementId: d.elementId,
          kind: 'upsert' as const,
          element: d.element,
          version: d.version,
          versionNonce: d.version,
        })),
      },
    });
  }

  it('restore creates a new revision; earlier AND later revisions/snapshots stay queryable, and the scene reflects the restored snapshot', async () => {
    const owner = await seedUserWithSession('restore-happy');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'happy');

    const op1 = await submitBatch(
      owner.cookies,
      diagramId,
      owner.user.id,
      [{ elementId: 'el-1', element: { id: 'el-1', type: 'rectangle', version: 1 }, version: 1 }],
      0,
    );
    expect(op1.statusCode).toBe(200);

    const snapshotA = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/snapshots`,
      cookies: owner.cookies,
      payload: { name: 'checkpoint A' },
    });
    expect(snapshotA.statusCode).toBe(201);
    const snapshotAId = snapshotA.json().snapshot.id as string;

    const op2 = await submitBatch(
      owner.cookies,
      diagramId,
      owner.user.id,
      [{ elementId: 'el-2', element: { id: 'el-2', type: 'rectangle', version: 1 }, version: 1 }],
      1,
    );
    expect(op2.statusCode).toBe(200);

    const snapshotB = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/snapshots`,
      cookies: owner.cookies,
      payload: { name: 'checkpoint B' },
    });
    const snapshotBId = snapshotB.json().snapshot.id as string;

    // Restore to checkpoint A — el-2 (added after A) should disappear from the scene.
    const restoreResponse = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/snapshots/${snapshotAId}:restore`,
      cookies: owner.cookies,
    });
    expect(restoreResponse.statusCode).toBe(200);
    expect(restoreResponse.json().restoredFromSnapshotId).toBe(snapshotAId);
    expect(restoreResponse.json().currentRevision).toBe(3); // op1(1), op2(2), restore(3)

    // The op-log for revisions 1 and 2 (before AND between the restore point) is untouched.
    const opsResponse = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/operations?afterSequence=0`,
      cookies: owner.cookies,
    });
    const sequences = opsResponse.json().operations.map((op: { sequence: number }) => op.sequence);
    expect(sequences).toEqual(expect.arrayContaining([1, 2, 3]));

    // Both snapshots (before AND after the restored one) remain listed.
    const listResponse = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/snapshots`,
      cookies: owner.cookies,
    });
    const snapshotIds = listResponse.json().snapshots.map((s: { id: string }) => s.id);
    expect(snapshotIds).toEqual(expect.arrayContaining([snapshotAId, snapshotBId]));

    // The bootstrapped scene now reflects checkpoint A's content: el-1 present, el-2 tombstoned
    // (isDeleted:true) — scene arrays retain tombstones, same convention as the rest of the
    // system (a delete never removes the row from the returned array, it flags it).
    const bootstrap = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/bootstrap`,
      cookies: owner.cookies,
    });
    const scene = bootstrap.json().scene as Array<{ id: string; isDeleted?: boolean }>;
    const liveIds = scene.filter((el) => !el.isDeleted).map((el) => el.id);
    expect(liveIds).toEqual(['el-1']);
    const el2 = scene.find((el) => el.id === 'el-2');
    expect(el2?.isDeleted).toBe(true);
  });

  it("restoring OVER a published snapshot never modifies that snapshot's own bytes (checksum/sceneJsonKey unchanged)", async () => {
    const owner = await seedUserWithSession('restore-immutable');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'immutable');

    await submitBatch(
      owner.cookies,
      diagramId,
      owner.user.id,
      [{ elementId: 'el-1', element: { id: 'el-1', type: 'rectangle', version: 1 }, version: 1 }],
      0,
    );

    // Create a published (immutable) snapshot directly — the HTTP route only creates 'named'.
    const published = await createSnapshot(db, storage, {
      diagramId,
      kind: 'published',
      name: 'v1.0',
      createdBy: owner.user.id,
    });
    expect(published.immutable).toBe(true);
    const bytesBefore = storage.objects.get(`exports/${published.sceneJsonKey}`);

    await submitBatch(
      owner.cookies,
      diagramId,
      owner.user.id,
      [{ elementId: 'el-2', element: { id: 'el-2', type: 'rectangle', version: 1 }, version: 1 }],
      1,
    );

    const restoreResponse = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/snapshots/${published.id}:restore`,
      cookies: owner.cookies,
    });
    expect(restoreResponse.statusCode).toBe(200);

    const [row] = await db
      .select()
      .from(schema.diagramSnapshots)
      .where(eq(schema.diagramSnapshots.id, published.id));
    expect(row).toMatchObject({
      checksum: published.checksum,
      sceneJsonKey: published.sceneJsonKey,
      immutable: true,
    });
    expect(storage.objects.get(`exports/${published.sceneJsonKey}`)).toBe(bytesBefore);
  });

  it('restoring an unknown snapshot id returns 404', async () => {
    const owner = await seedUserWithSession('restore-missing');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'missing');

    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/snapshots/00000000-0000-4000-8000-000000000000:restore`,
      cookies: owner.cookies,
    });
    expect(response.statusCode).toBe(404);
  });

  it('a reviewer receives 403 restoring a snapshot (diagram:mutate required)', async () => {
    const owner = await seedUserWithSession('restore-rbac-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'rbac');
    const snapshot = await createSnapshot(db, storage, {
      diagramId,
      kind: 'named',
      createdBy: owner.user.id,
    });
    const reviewer = await seedUserWithSession('restore-rbac-reviewer');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: reviewer.user.id, role: 'reviewer' });

    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/snapshots/${snapshot.id}:restore`,
      cookies: reviewer.cookies,
    });
    expect(response.statusCode).toBe(403);
  });

  it('diff between two revisions reports added/removed/moved/modified for a scenario with one of each', async () => {
    const owner = await seedUserWithSession('diff-happy');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'happy');

    const first = await submitBatch(
      owner.cookies,
      diagramId,
      owner.user.id,
      [
        {
          elementId: 'el-removed',
          element: { id: 'el-removed', type: 'rectangle', x: 0, y: 0, version: 1 },
          version: 1,
        },
        {
          elementId: 'el-moved',
          element: { id: 'el-moved', type: 'rectangle', x: 0, y: 0, version: 1 },
          version: 1,
        },
        {
          elementId: 'el-modified',
          element: {
            id: 'el-modified',
            type: 'rectangle',
            x: 0,
            y: 0,
            backgroundColor: '#000000',
            version: 1,
          },
          version: 1,
        },
      ],
      0,
    );
    expect(first.statusCode).toBe(200);
    const fromRevision = first.json().currentRevision as number;

    const second = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies: owner.cookies,
      payload: {
        clientMutationId: randomUUID(),
        baseRevision: fromRevision,
        actorId: owner.user.id,
        deltas: [
          { elementId: 'el-removed', kind: 'delete', version: 2, versionNonce: 2 },
          {
            elementId: 'el-moved',
            kind: 'upsert',
            element: { id: 'el-moved', type: 'rectangle', x: 99, y: 99, version: 2 },
            version: 2,
            versionNonce: 2,
          },
          {
            elementId: 'el-modified',
            kind: 'upsert',
            element: {
              id: 'el-modified',
              type: 'rectangle',
              x: 0,
              y: 0,
              backgroundColor: '#ffffff',
              version: 2,
            },
            version: 2,
            versionNonce: 2,
          },
          {
            elementId: 'el-added',
            kind: 'upsert',
            element: { id: 'el-added', type: 'rectangle', x: 5, y: 5, version: 1 },
            version: 1,
            versionNonce: 1,
          },
        ],
      },
    });
    expect(second.statusCode).toBe(200);
    const toRevision = second.json().currentRevision as number;

    const diffResponse = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/diff?from=${fromRevision}&to=${toRevision}`,
      cookies: owner.cookies,
    });

    expect(diffResponse.statusCode).toBe(200);
    const body = diffResponse.json();
    expect(body.added).toEqual(['el-added']);
    expect(body.removed).toEqual(['el-removed']);
    expect(body.moved).toEqual(['el-moved']);
    expect(body.modified).toEqual(['el-modified']);
  });

  it('diff accepts snapshot ids as from/to, not just revision numbers', async () => {
    const owner = await seedUserWithSession('diff-snap-ids');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'snap-ids');

    await submitBatch(
      owner.cookies,
      diagramId,
      owner.user.id,
      [{ elementId: 'el-1', element: { id: 'el-1', type: 'rectangle', version: 1 }, version: 1 }],
      0,
    );
    const snapA = await createSnapshot(db, storage, {
      diagramId,
      kind: 'named',
      createdBy: owner.user.id,
    });

    await submitBatch(
      owner.cookies,
      diagramId,
      owner.user.id,
      [{ elementId: 'el-2', element: { id: 'el-2', type: 'rectangle', version: 1 }, version: 1 }],
      1,
    );
    const snapB = await createSnapshot(db, storage, {
      diagramId,
      kind: 'named',
      createdBy: owner.user.id,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/diff?from=${snapA.id}&to=${snapB.id}`,
      cookies: owner.cookies,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().added).toEqual(['el-2']);
  });

  it('diff with an unresolvable target returns 404', async () => {
    const owner = await seedUserWithSession('diff-missing');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'missing');

    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/diff?from=0&to=not-a-revision-or-snapshot-id`,
      cookies: owner.cookies,
    });
    expect(response.statusCode).toBe(404);
  });
});
