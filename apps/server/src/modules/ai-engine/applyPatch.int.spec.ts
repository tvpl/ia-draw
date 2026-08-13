// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).
//
// Storage is an in-memory fake StorageClient (no real MinIO in this sandbox, T27's documented
// limitation, mirrored from snapshot/restore.int.spec.ts) — shared between the ai-engine module
// (writes the pre_ai snapshot) and the snapshot module (reads it back on restore), so this test
// can prove the undo round-trip for real.

import { randomUUID } from 'node:crypto';
import { encryptToken } from '@arch-canvas/ai-tools';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
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
import { loadDiagramScene } from '../diagram-sync/scene.js';
import { registerSnapshotModule } from '../snapshot/routes.js';
import type { StorageClient } from '../storage/signedUrl.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { registerAiEngineModule } from './routes.js';

const ENCRYPTION_KEY = 'test-encryption-master-key-for-ai-engine-apply';
const TEST_TOKEN = 'sk-ai-engine-apply-test-token';

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

function toolCallResponse(toolName: string, args: Record<string, unknown>) {
  return {
    status: 200,
    body: {
      id: 'resp-1',
      model: 'test-model',
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'call-1', function: { name: toolName, arguments: JSON.stringify(args) } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    },
  };
}

function scriptedFetch(responses: Array<{ status: number; body: unknown }>): typeof fetch {
  let index = 0;
  return (async () => {
    const next = responses[Math.min(index, responses.length - 1)] ?? responses[0];
    index += 1;
    if (!next) throw new Error('scriptedFetch: no responses configured');
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('ai-engine atomic apply + pre-ai snapshot + undo (T55, AIG-05/AIE-03)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let app: FastifyInstance;
  let storage: ReturnType<typeof createFakeStorage>;
  let currentFetchImpl: typeof fetch;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });
    storage = createFakeStorage();
    currentFetchImpl = scriptedFetch([{ status: 500, body: {} }]);

    const config = loadConfig({ NODE_ENV: 'test' });
    app = buildServer(config);
    await registerAuthModule(app, { db, config });
    registerWorkspaceModule(app, { db });
    registerDiagramSyncModule(app, { db });
    registerSnapshotModule(app, { db, storage });
    registerAiEngineModule(app, {
      db,
      encryptionKey: ENCRYPTION_KEY,
      storage,
      // Indirection so each test can swap the script without re-registering the module.
      fetchImpl: ((...args: Parameters<typeof fetch>) => currentFetchImpl(...args)) as typeof fetch,
    });
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
      payload: { name: `AI Apply WS ${slug}`, slug: `ai-apply-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `AI Apply Project ${slug}` },
    });
    const projectId = createProject.json().project.id;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `AI Apply Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id };
  }

  async function seedProviderConfig(scope: string) {
    await db.insert(schema.aiProviderConfigs).values({
      scope,
      baseUrl: 'http://127.0.0.1:9/unused', // never dialed — fetchImpl is always injected
      model: 'test-model',
      encryptedToken: encryptToken(TEST_TOKEN, ENCRYPTION_KEY),
    });
  }

  async function createRun(
    cookies: Record<string, string>,
    diagramId: string,
    userRequest: string,
  ) {
    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/ai/runs`,
      cookies,
      payload: { userRequest },
    });
    expect(response.statusCode).toBe(201);
    return response.json();
  }

  it('approving a run with a still-valid sourceRevision applies the patch atomically and creates a pre_ai snapshot', async () => {
    const owner = await seedUserWithSession('apply-happy');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'happy');
    await seedProviderConfig(workspaceId);
    currentFetchImpl = scriptedFetch([
      toolCallResponse('create_element', { type: 'rectangle', x: 0, y: 0, label: 'API' }),
    ]);

    const created = await createRun(owner.cookies, diagramId, 'Crie um servidor de API');
    expect(created.run.status).toBe('awaiting_approval');

    const approve = await app.inject({
      method: 'POST',
      url: `/ai/runs/${created.run.id}:approve`,
      cookies: owner.cookies,
    });

    expect(approve.statusCode).toBe(200);
    const approveBody = approve.json();
    expect(approveBody.run.status).toBe('applied');
    expect(approveBody.snapshot.kind).toBe('pre_ai');
    expect(approveBody.batch.currentRevision).toBeGreaterThan(0);

    const { scene, revision } = await loadDiagramScene(db, diagramId);
    expect(revision).toBeGreaterThan(0);
    expect(scene.some((el) => (el as { type: string }).type === 'rectangle')).toBe(true);

    const snapshots = await db
      .select()
      .from(schema.diagramSnapshots)
      .where(
        and(
          eq(schema.diagramSnapshots.diagramId, diagramId),
          eq(schema.diagramSnapshots.kind, 'pre_ai'),
        ),
      );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.immutable).toBe(true);

    // SEC-04: exactly one audit_events row for this AI patch approval.
    const auditRows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, 'ai_run.patch.approved'));
    const matching = auditRows.filter((row) => row.resourceId === diagramId);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({
      actorId: owner.user.id,
      action: 'ai_run.patch.approved',
      resourceType: 'diagram',
      resourceId: diagramId,
    });
    expect(matching[0]?.metadataJson).toMatchObject({ aiRunId: created.run.id });
  });

  it('approving a run whose sourceRevision went stale returns 409 and never applies the patch', async () => {
    const owner = await seedUserWithSession('apply-stale');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'stale');
    await seedProviderConfig(workspaceId);
    currentFetchImpl = scriptedFetch([
      toolCallResponse('create_element', { type: 'rectangle', x: 0, y: 0, label: 'API' }),
    ]);

    const created = await createRun(owner.cookies, diagramId, 'Crie um servidor de API');
    expect(created.run.status).toBe('awaiting_approval');

    // Another mutation lands on the diagram AFTER the run's preview — the run's
    // frozen sourceRevision is now stale.
    const manualBatch = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies: owner.cookies,
      payload: {
        clientMutationId: randomUUID(),
        baseRevision: created.run.sourceRevision,
        actorId: owner.user.id,
        deltas: [
          {
            elementId: 'manual-el',
            kind: 'upsert',
            element: { id: 'manual-el', type: 'rectangle', version: 1, versionNonce: 1 },
            version: 1,
            versionNonce: 1,
          },
        ],
      },
    });
    expect(manualBatch.statusCode).toBe(200);
    const { scene: sceneBeforeApprove } = await loadDiagramScene(db, diagramId);

    const approve = await app.inject({
      method: 'POST',
      url: `/ai/runs/${created.run.id}:approve`,
      cookies: owner.cookies,
    });

    expect(approve.statusCode).toBe(409);

    // The scene is untouched by the AI patch — still exactly what the manual batch left it as.
    const { scene: sceneAfterApprove } = await loadDiagramScene(db, diagramId);
    expect(sceneAfterApprove).toEqual(sceneBeforeApprove);
    expect(sceneAfterApprove.some((el) => (el as { id: string }).id === 'manual-el')).toBe(true);
  });

  it('restoring the pre_ai snapshot reverts the scene to the state right before the AI patch applied (undo)', async () => {
    const owner = await seedUserWithSession('apply-undo');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'undo');
    await seedProviderConfig(workspaceId);

    // A pre-existing element the AI's patch will NOT touch — proves the undo restores it too.
    await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies: owner.cookies,
      payload: {
        clientMutationId: randomUUID(),
        baseRevision: 0,
        actorId: owner.user.id,
        deltas: [
          {
            elementId: 'pre-existing',
            kind: 'upsert',
            element: { id: 'pre-existing', type: 'rectangle', version: 1, versionNonce: 1 },
            version: 1,
            versionNonce: 1,
          },
        ],
      },
    });
    const { scene: sceneBeforeAi } = await loadDiagramScene(db, diagramId);

    currentFetchImpl = scriptedFetch([
      toolCallResponse('create_element', { type: 'rectangle', x: 0, y: 0, label: 'API' }),
    ]);
    const created = await createRun(owner.cookies, diagramId, 'Crie um servidor de API');
    const approve = await app.inject({
      method: 'POST',
      url: `/ai/runs/${created.run.id}:approve`,
      cookies: owner.cookies,
    });
    expect(approve.statusCode).toBe(200);
    const snapshotId = approve.json().snapshot.id;

    const { scene: sceneAfterAi } = await loadDiagramScene(db, diagramId);
    expect(sceneAfterAi.length).toBeGreaterThan(sceneBeforeAi.length);

    const restore = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/snapshots/${snapshotId}:restore`,
      cookies: owner.cookies,
    });
    expect(restore.statusCode).toBe(200);

    const { scene: sceneAfterUndo } = await loadDiagramScene(db, diagramId);
    const liveIds = sceneAfterUndo
      .filter((el) => !(el as { isDeleted?: boolean }).isDeleted)
      .map((el) => (el as { id: string }).id)
      .sort();
    const expectedIds = sceneBeforeAi
      .filter((el) => !(el as { isDeleted?: boolean }).isDeleted)
      .map((el) => (el as { id: string }).id)
      .sort();
    expect(liveIds).toEqual(expectedIds);
  });

  it('cancelling a run leaves no trace on the real scene', async () => {
    const owner = await seedUserWithSession('apply-cancel');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'cancel');
    await seedProviderConfig(workspaceId);
    currentFetchImpl = scriptedFetch([
      toolCallResponse('create_element', { type: 'rectangle', x: 0, y: 0, label: 'API' }),
    ]);

    const { revision: revisionBefore } = await loadDiagramScene(db, diagramId);
    const created = await createRun(owner.cookies, diagramId, 'Crie um servidor de API');

    const cancel = await app.inject({
      method: 'POST',
      url: `/ai/runs/${created.run.id}:cancel`,
      cookies: owner.cookies,
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().run.status).toBe('cancelled');

    const { revision: revisionAfter } = await loadDiagramScene(db, diagramId);
    expect(revisionAfter).toBe(revisionBefore);

    const ops = await db
      .select()
      .from(schema.diagramOperations)
      .where(eq(schema.diagramOperations.diagramId, diagramId));
    expect(ops).toHaveLength(0);

    // Approving after cancel is rejected — the run is terminal.
    const approveAfterCancel = await app.inject({
      method: 'POST',
      url: `/ai/runs/${created.run.id}:approve`,
      cookies: owner.cookies,
    });
    expect(approveAfterCancel.statusCode).toBe(409);
  });

  it('reviewer and viewer receive 403 on :approve and :cancel', async () => {
    const owner = await seedUserWithSession('apply-rbac-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'rbac');
    await seedProviderConfig(workspaceId);
    currentFetchImpl = scriptedFetch([
      toolCallResponse('create_element', { type: 'rectangle', x: 0, y: 0, label: 'API' }),
    ]);
    const created = await createRun(owner.cookies, diagramId, 'Crie um servidor de API');

    for (const role of ['reviewer', 'viewer'] as const) {
      const actor = await seedUserWithSession(`apply-rbac-${role}`);
      await db.insert(schema.workspaceMembers).values({ workspaceId, userId: actor.user.id, role });

      const approve = await app.inject({
        method: 'POST',
        url: `/ai/runs/${created.run.id}:approve`,
        cookies: actor.cookies,
      });
      expect(approve.statusCode).toBe(403);

      const cancel = await app.inject({
        method: 'POST',
        url: `/ai/runs/${created.run.id}:cancel`,
        cookies: actor.cookies,
      });
      expect(cancel.statusCode).toBe(403);
    }
  });
});
