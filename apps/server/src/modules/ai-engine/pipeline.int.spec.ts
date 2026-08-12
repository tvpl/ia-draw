// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).

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
import type { StorageClient } from '../storage/signedUrl.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import type { AiRunStatus } from './aiRuns.js';
import { createAiRun } from './pipeline.js';
import { registerAiEngineModule } from './routes.js';
import { RunStore } from './runStore.js';

const ENCRYPTION_KEY = 'test-encryption-master-key-for-ai-engine';
const TEST_TOKEN = 'sk-ai-engine-pipeline-test-token';

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

/** Deterministic provider double — never a real network call (T53 "Done when"). Each call to `next()` returns the next queued response, so a test can script a sequence of provider replies. */
function scriptedFetch(responses: Array<{ status: number; body: unknown }>): {
  fetchImpl: typeof fetch;
  calls: Array<{ body: unknown }>;
} {
  const calls: Array<{ body: unknown }> = [];
  let index = 0;
  const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ body });
    const next = responses[Math.min(index, responses.length - 1)] ?? responses[0];
    index += 1;
    if (!next) throw new Error('scriptedFetch: no responses configured');
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function toolCallResponse(
  toolName: string,
  args: Record<string, unknown>,
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
) {
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
      ...(usage ? { usage } : {}),
    },
  };
}

describe('ai-engine pipeline (T53, AIG-01/AIE-01/AIE-05)', () => {
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
      payload: { name: `AI Engine WS ${slug}`, slug: `ai-engine-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `AI Engine Project ${slug}` },
    });
    const projectId = createProject.json().project.id;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `AI Engine Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id };
  }

  async function seedProviderConfig(scope: string) {
    const [config] = await db
      .insert(schema.aiProviderConfigs)
      .values({
        scope,
        baseUrl: 'http://127.0.0.1:9/unused', // never dialed — fetchImpl is always injected
        model: 'test-model',
        encryptedToken: encryptToken(TEST_TOKEN, ENCRYPTION_KEY),
      })
      .returning();
    if (!config) throw new Error('provider config insert failed');
    return config;
  }

  describe('state machine progression (Done when #1)', () => {
    it('a successful mock-provider call progresses queued -> building_context -> calling_model -> validating -> previewing', async () => {
      const owner = await seedUserWithSession('pipeline-happy');
      const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'happy');
      await seedProviderConfig(workspaceId);

      const { fetchImpl } = scriptedFetch([
        toolCallResponse('create_element', { type: 'rectangle', x: 0, y: 0, label: 'API' }),
      ]);

      const transitions: AiRunStatus[] = [];
      const result = await createAiRun(
        {
          db,
          encryptionKey: ENCRYPTION_KEY,
          fetchImpl,
          runStore: new RunStore(),
          onTransition: (_runId, status) => transitions.push(status),
        },
        { diagramId, workspaceId, userId: owner.user.id, userRequest: 'Crie um servidor de API' },
      );

      expect(transitions).toEqual([
        'queued',
        'building_context',
        'calling_model',
        'validating',
        'previewing',
      ]);
      expect(result.run.status).toBe('previewing');
      expect(result.patch?.operations.length).toBeGreaterThan(0);
    });

    it('a provider HTTP error progresses to failed with a structured errorCode, never an unhandled exception', async () => {
      const owner = await seedUserWithSession('pipeline-failed');
      const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'failed');
      await seedProviderConfig(workspaceId);

      const { fetchImpl } = scriptedFetch([{ status: 500, body: { error: 'provider down' } }]);

      const transitions: AiRunStatus[] = [];
      const result = await createAiRun(
        {
          db,
          encryptionKey: ENCRYPTION_KEY,
          fetchImpl,
          runStore: new RunStore(),
          onTransition: (_runId, status) => transitions.push(status),
        },
        { diagramId, workspaceId, userId: owner.user.id, userRequest: 'Crie um servidor de API' },
      );

      expect(transitions).toEqual(['queued', 'building_context', 'calling_model', 'failed']);
      expect(result.run.status).toBe('failed');
      expect(result.run.errorCode).toBe('http_error');
      expect(result.patch).toBeUndefined();
    });

    it('a tool call referencing an elementId outside the diagram fails the run before previewing (AIG-06)', async () => {
      const owner = await seedUserWithSession('pipeline-oob');
      const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'oob');
      await seedProviderConfig(workspaceId);

      const { fetchImpl } = scriptedFetch([
        toolCallResponse('delete_elements', { elementIds: ['does-not-exist'] }),
      ]);

      const result = await createAiRun(
        { db, encryptionKey: ENCRYPTION_KEY, fetchImpl, runStore: new RunStore() },
        { diagramId, workspaceId, userId: owner.user.id, userRequest: 'Apague o elemento X' },
      );

      expect(result.run.status).toBe('failed');
      expect(result.run.errorCode).toBe('element_not_found');
    });
  });

  describe('ai_tool_calls audit trail redaction (Done when #2)', () => {
    it('persists the tool call with sensitive free-text arguments replaced, never in plain text', async () => {
      const owner = await seedUserWithSession('pipeline-redact');
      const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'redact');
      await seedProviderConfig(workspaceId);

      const SENSITIVE = 'SENSITIVE-TEST-LABEL-do-not-leak-9f3a';
      const { fetchImpl } = scriptedFetch([
        toolCallResponse('create_element', { type: 'rectangle', x: 0, y: 0, label: SENSITIVE }),
      ]);

      const result = await createAiRun(
        { db, encryptionKey: ENCRYPTION_KEY, fetchImpl, runStore: new RunStore() },
        { diagramId, workspaceId, userId: owner.user.id, userRequest: 'Crie um elemento' },
      );

      const rows = await db
        .select()
        .from(schema.aiToolCalls)
        .where(eq(schema.aiToolCalls.aiRunId, result.run.id));
      expect(rows).toHaveLength(1);
      const row = rows[0];
      if (!row) throw new Error('expected one ai_tool_calls row');
      expect(row.toolName).toBe('create_element');
      const args = row.argumentsRedacted as { label?: string; type?: string };
      expect(args.label).toBe('[redacted]');
      // The full persisted row, serialized, never contains the sensitive substring anywhere.
      expect(JSON.stringify(row)).not.toContain(SENSITIVE);
      // Structural fields (needed for audit) survive redaction.
      expect(args.type).toBe('rectangle');
    });
  });

  describe('token usage recorded in the audit trail (AIE-05)', () => {
    it('persists the provider-reported token usage on the run row', async () => {
      const owner = await seedUserWithSession('pipeline-usage');
      const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'usage');
      await seedProviderConfig(workspaceId);

      const { fetchImpl } = scriptedFetch([
        toolCallResponse(
          'create_element',
          { type: 'rectangle', x: 0, y: 0, label: 'API' },
          { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 },
        ),
      ]);

      const result = await createAiRun(
        { db, encryptionKey: ENCRYPTION_KEY, fetchImpl, runStore: new RunStore() },
        { diagramId, workspaceId, userId: owner.user.id, userRequest: 'Crie um elemento' },
      );

      expect(result.run.usageJson).toEqual({
        promptTokens: 123,
        completionTokens: 45,
        totalTokens: 168,
      });
    });
  });

  describe('RBAC (Done when #3)', () => {
    it('reviewer and viewer receive 403 attempting to create a run (never persisted)', async () => {
      const runStore = new RunStore();
      const rbacApp = buildServer(loadConfig({ NODE_ENV: 'test' }));
      await registerAuthModule(rbacApp, { db, config: loadConfig({ NODE_ENV: 'test' }) });
      registerWorkspaceModule(rbacApp, { db });
      registerAiEngineModule(rbacApp, {
        db,
        encryptionKey: ENCRYPTION_KEY,
        storage: createFakeStorage(),
        runStore,
      });
      await rbacApp.ready();

      try {
        const owner = await seedUserWithSession('pipeline-rbac-owner');
        const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'rbac');
        await seedProviderConfig(workspaceId);

        for (const role of ['reviewer', 'viewer'] as const) {
          const actor = await seedUserWithSession(`pipeline-rbac-${role}`);
          await db
            .insert(schema.workspaceMembers)
            .values({ workspaceId, userId: actor.user.id, role });

          const response = await rbacApp.inject({
            method: 'POST',
            url: `/diagrams/${diagramId}/ai/runs`,
            cookies: actor.cookies,
            payload: { userRequest: 'Crie um diagrama' },
          });

          expect(response.statusCode).toBe(403);
        }

        const runs = await db
          .select()
          .from(schema.aiRuns)
          .where(eq(schema.aiRuns.diagramId, diagramId));
        expect(runs).toHaveLength(0);
      } finally {
        await rbacApp.close();
      }
    });
  });

  describe('no provider configured', () => {
    it('returns a structured error and creates no ai_runs row', async () => {
      const owner = await seedUserWithSession('pipeline-no-provider');
      const { diagramId } = await seedDiagramAs(owner.cookies, 'no-provider');
      // Deliberately no seedProviderConfig() call for this workspace.

      const noProviderApp = buildServer(loadConfig({ NODE_ENV: 'test' }));
      await registerAuthModule(noProviderApp, { db, config: loadConfig({ NODE_ENV: 'test' }) });
      registerWorkspaceModule(noProviderApp, { db });
      registerAiEngineModule(noProviderApp, {
        db,
        encryptionKey: ENCRYPTION_KEY,
        storage: createFakeStorage(),
      });
      await noProviderApp.ready();

      try {
        const response = await noProviderApp.inject({
          method: 'POST',
          url: `/diagrams/${diagramId}/ai/runs`,
          cookies: owner.cookies,
          payload: { userRequest: 'Crie um diagrama' },
        });

        expect(response.statusCode).toBeGreaterThanOrEqual(400);
        expect(response.statusCode).toBeLessThan(500);

        const runs = await db
          .select()
          .from(schema.aiRuns)
          .where(eq(schema.aiRuns.diagramId, diagramId));
        expect(runs).toHaveLength(0);
      } finally {
        await noProviderApp.close();
      }
    });
  });
});
