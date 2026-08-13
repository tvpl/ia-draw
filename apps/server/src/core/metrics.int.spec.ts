// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).

import { randomUUID } from 'node:crypto';
import { encryptToken } from '@arch-canvas/ai-tools';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createAiRun } from '../modules/ai-engine/pipeline.js';
import { RunStore } from '../modules/ai-engine/runStore.js';
import { createLocalAccount } from '../modules/auth/accounts.js';
import { SESSION_COOKIE_NAME } from '../modules/auth/cookie.js';
import { registerAuthModule } from '../modules/auth/routes.js';
import { createSession } from '../modules/auth/session.js';
import { registerDiagramSyncModule } from '../modules/diagram-sync/routes.js';
import { registerWorkspaceModule } from '../modules/workspace/index.js';
import { NullPresenceBroadcaster } from '../modules/ws-gateway/presence.js';
import { registerWsGatewayModule } from '../modules/ws-gateway/routes.js';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

const ENCRYPTION_KEY = 'test-encryption-master-key-for-metrics-int';
const TEST_TOKEN = 'sk-metrics-int-test-token';

function wsEnvelope(diagramId: string, type: string, payload: unknown) {
  return {
    protocolVersion: 1,
    diagramId,
    messageId: randomUUID(),
    sentAt: new Date().toISOString(),
    type,
    payload,
  };
}

function rectangleDelta(elementId: string) {
  return {
    elementId,
    kind: 'upsert',
    element: { id: elementId, type: 'rectangle', version: 1, versionNonce: 1 },
    version: 1,
    versionNonce: 1,
  };
}

/**
 * `GET /metrics` end-to-end proof (OBS-01, T91) — every module registered
 * against ONE `app` shares the SAME `app.metrics` registry (the same
 * wiring `registerAllModules` does in production), so a real REST
 * mutation, a real WS mutation, and a real (mocked-`fetchImpl`) AI run all
 * land in the ONE registry `GET /metrics` serves — proving the "shared
 * registry across transports/modules" invariant, not just that each
 * individual `observe*` method works in isolation (already unit-tested in
 * `metrics.spec.ts`).
 */
describe('GET /metrics end-to-end — REST, WS, and AI-run instrumentation share one registry (OBS-01, T91)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let app: FastifyInstance;
  let wsUrl: string;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const config = loadConfig({ NODE_ENV: 'test' });
    app = buildServer(config);
    await registerAuthModule(app, { db, config });
    registerWorkspaceModule(app, { db });
    registerDiagramSyncModule(app, { db, metrics: app.metrics });
    await registerWsGatewayModule(app, {
      db,
      presence: new NullPresenceBroadcaster(),
      metrics: app.metrics,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });

    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('expected a bound TCP address');
    wsUrl = `ws://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    await client.close();
  });

  const openSockets: WebSocket[] = [];
  afterEach(() => {
    for (const socket of openSockets.splice(0)) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.terminate();
      }
    }
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
      payload: { name: `Metrics WS ${slug}`, slug: `metrics-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Metrics Project ${slug}` },
    });
    const projectId = createProject.json().project.id;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Metrics Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id as string };
  }

  it('a real REST operations:batch mutation increments mutation_ack_duration_seconds{transport="rest"}', async () => {
    const owner = await seedUserWithSession('metrics-rest');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'rest');

    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies: owner.cookies,
      payload: {
        clientMutationId: randomUUID(),
        baseRevision: 0,
        actorId: owner.user.id,
        deltas: [rectangleDelta(randomUUID())],
      },
    });
    expect(response.statusCode).toBe(200);

    const metricsResponse = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metricsResponse.body).toMatch(
      /arch_canvas_mutation_ack_duration_seconds_count\{transport="rest"\} [1-9]/,
    );
    // The REST request itself is also observed by the generic REST hook.
    expect(metricsResponse.body).toMatch(
      /arch_canvas_http_request_duration_seconds_count\{method="POST",route="\/diagrams\/:id\/operations:batch",status_code="200"\} [1-9]/,
    );
  });

  it('a real WS mutation increments the SAME mutation_ack_duration_seconds histogram with transport="ws"', async () => {
    const owner = await seedUserWithSession('metrics-ws');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'ws');

    const ticketResponse = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/ws-ticket`,
      cookies: owner.cookies,
    });
    const ticket = ticketResponse.json().ticket as string;

    const socket = new WebSocket(
      `${wsUrl}/ws/diagrams/${diagramId}?ticket=${encodeURIComponent(ticket)}`,
    );
    openSockets.push(socket);

    await new Promise<void>((resolve, reject) => {
      socket.once('message', () => resolve()); // 'hello'
      socket.once('error', reject);
    });

    const ackPromise = new Promise<void>((resolve, reject) => {
      socket.once('message', (raw: Buffer) => {
        const parsed = JSON.parse(raw.toString('utf8'));
        if (parsed.type === 'mutation_ack') resolve();
        else reject(new Error(`expected mutation_ack, got ${parsed.type}`));
      });
    });

    socket.send(
      JSON.stringify(
        wsEnvelope(diagramId, 'mutation', {
          clientMutationId: randomUUID(),
          baseRevision: 0,
          deltas: [rectangleDelta(randomUUID())],
        }),
      ),
    );
    await ackPromise;

    const metricsResponse = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metricsResponse.body).toMatch(
      /arch_canvas_mutation_ack_duration_seconds_count\{transport="ws"\} [1-9]/,
    );
  });

  it('a real AI run (mocked fetchImpl, same pattern as F2c) reflects its EXACT usage_json into the token/estimated-cost counters of app.metrics', async () => {
    const owner = await seedUserWithSession('metrics-ai');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'ai');

    const [providerConfig] = await db
      .insert(schema.aiProviderConfigs)
      .values({
        scope: workspaceId,
        baseUrl: 'http://127.0.0.1:9/unused', // never dialed — fetchImpl is always injected
        model: 'test-model',
        encryptedToken: encryptToken(TEST_TOKEN, ENCRYPTION_KEY),
      })
      .returning();
    if (!providerConfig) throw new Error('provider config insert failed');

    // Real numbers, deliberately not round, so a passing assertion can't be
    // coincidental — proves the counters reflect THIS run's usage_json, not
    // some pre-seeded default.
    const usage = { prompt_tokens: 317, completion_tokens: 129, total_tokens: 446 };
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          id: 'resp-metrics-ai',
          model: 'test-model',
          choices: [{ message: { content: 'no tool calls needed' }, finish_reason: 'stop' }],
          usage,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;

    // Same call shape `pipeline.int.spec.ts` uses — the metrics observation
    // this test proves is INSIDE `createAiRun` itself (`pipeline.ts`), so
    // calling it directly (bypassing the HTTP route/rate-limit layer, which
    // is already covered by `ai-engine`'s own route tests) is the most
    // direct proof that `deps.metrics` reaches the observation call.
    const result = await createAiRun(
      {
        db,
        encryptionKey: ENCRYPTION_KEY,
        fetchImpl,
        runStore: new RunStore(),
        metrics: app.metrics,
      },
      { diagramId, workspaceId, userId: owner.user.id, userRequest: 'Explique este diagrama' },
    );
    expect(result.run.status).toBe('previewing');

    const metricsResponse = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metricsResponse.body).toMatch(/arch_canvas_ai_run_tokens_total\{kind="prompt"\} 317/);
    expect(metricsResponse.body).toMatch(
      /arch_canvas_ai_run_tokens_total\{kind="completion"\} 129/,
    );
    expect(metricsResponse.body).toMatch(
      /arch_canvas_ai_run_duration_seconds_count\{outcome="previewing"\} 1/,
    );
    expect(metricsResponse.body).toMatch(/arch_canvas_ai_run_estimated_cost_usd_total 0\.00446/);
  });
});
