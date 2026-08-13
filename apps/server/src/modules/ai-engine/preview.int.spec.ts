// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).

import { randomUUID } from 'node:crypto';
import { encryptToken } from '@arch-canvas/ai-tools';
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
import { loadDiagramScene } from '../diagram-sync/scene.js';
import type { StorageClient } from '../storage/signedUrl.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { registerAiEngineModule } from './routes.js';

const ENCRYPTION_KEY = 'test-encryption-master-key-for-ai-engine-preview';
const TEST_TOKEN = 'sk-ai-engine-preview-test-token';

/** Not exercised by this file's scenarios (no `:approve` call here — that's applyPatch.int.spec.ts) — a minimal fake satisfying `AiEngineModuleDeps.storage`'s required shape. */
function createFakeStorage(): StorageClient {
  return {
    async putSignedUrl(bucket, key) {
      return `https://fake-storage.test/${bucket}/${key}`;
    },
    async getSignedUrl(bucket, key) {
      return `https://fake-storage.test/${bucket}/${key}`;
    },
    async headObject() {
      return { exists: false };
    },
    async putObject() {},
    async getObject() {
      throw new Error('createFakeStorage: getObject not exercised by this test file');
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

describe('ai-engine preview generation (T54, AIE-02/AIG-04)', () => {
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
    registerAiEngineModule(app, {
      db,
      encryptionKey: ENCRYPTION_KEY,
      storage: createFakeStorage(),
      fetchImpl: scriptedFetch([]),
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
      payload: { name: `AI Preview WS ${slug}`, slug: `ai-preview-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `AI Preview Project ${slug}` },
    });
    const projectId = createProject.json().project.id;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `AI Preview Diagram ${slug}` },
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

  it('generating a preview never touches diagram_operations — the diagram revision is identical before and after', async () => {
    const owner = await seedUserWithSession('preview-immutable');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'immutable');
    await seedProviderConfig(workspaceId);

    const previewApp = buildServer(loadConfig({ NODE_ENV: 'test' }));
    await registerAuthModule(previewApp, { db, config: loadConfig({ NODE_ENV: 'test' }) });
    registerWorkspaceModule(previewApp, { db });
    registerAiEngineModule(previewApp, {
      db,
      encryptionKey: ENCRYPTION_KEY,
      storage: createFakeStorage(),
      fetchImpl: scriptedFetch([
        toolCallResponse('create_element', { type: 'rectangle', x: 0, y: 0, label: 'API' }),
      ]),
    });
    await previewApp.ready();

    try {
      const { revision: revisionBefore } = await loadDiagramScene(db, diagramId);

      const response = await previewApp.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/ai/runs`,
        cookies: owner.cookies,
        payload: { userRequest: 'Crie um servidor de API' },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.run.status).toBe('awaiting_approval');
      expect(body.requiresExplicitApproval).toBe(false);
      expect(body.preview.added.length).toBeGreaterThan(0);

      const { revision: revisionAfter } = await loadDiagramScene(db, diagramId);
      expect(revisionAfter).toBe(revisionBefore);

      const ops = await db
        .select()
        .from(schema.diagramOperations)
        .where(eq(schema.diagramOperations.diagramId, diagramId));
      expect(ops).toHaveLength(0);
    } finally {
      await previewApp.close();
    }
  });

  it('a removal patch is returned with requiresExplicitApproval: true', async () => {
    const owner = await seedUserWithSession('preview-removal');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'removal');
    await seedProviderConfig(workspaceId);

    // Seed one real element first (via a normal batch) so delete_elements has something to reference.
    const batch = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies: owner.cookies,
      payload: {
        clientMutationId: randomUUID(),
        baseRevision: 0,
        actorId: owner.user.id,
        deltas: [
          {
            elementId: 'el-to-delete',
            kind: 'upsert',
            element: { id: 'el-to-delete', type: 'rectangle', version: 1, versionNonce: 1 },
            version: 1,
            versionNonce: 1,
          },
        ],
      },
    });
    expect(batch.statusCode).toBe(200);

    const removalApp = buildServer(loadConfig({ NODE_ENV: 'test' }));
    await registerAuthModule(removalApp, { db, config: loadConfig({ NODE_ENV: 'test' }) });
    registerWorkspaceModule(removalApp, { db });
    registerAiEngineModule(removalApp, {
      db,
      encryptionKey: ENCRYPTION_KEY,
      storage: createFakeStorage(),
      fetchImpl: scriptedFetch([
        toolCallResponse('delete_elements', { elementIds: ['el-to-delete'] }),
      ]),
    });
    await removalApp.ready();

    try {
      const response = await removalApp.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/ai/runs`,
        cookies: owner.cookies,
        payload: { userRequest: 'Apague o elemento antigo' },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.requiresExplicitApproval).toBe(true);
      expect(body.preview.removed).toEqual(['el-to-delete']);
    } finally {
      await removalApp.close();
    }
  });
});
