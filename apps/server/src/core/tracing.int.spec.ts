// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).

import { randomUUID } from 'node:crypto';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
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
import { createTracing } from './tracing.js';

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
 * DB/WS boundary end-to-end proof (OBS-02, T92) — mirrors
 * `metrics.int.spec.ts`'s "one shared registry across transports/modules"
 * structure, for spans instead of counters: a real REST mutation and a real
 * WS mutation both reach `diagram-sync/operations.ts`'s `appendOperation`
 * through the SAME `db.append_operation` span-wrapping call site
 * (`withOptionalSpan`), proving F4's "WS is just a second transport"
 * invariant holds at the tracing layer too, not only at the metrics layer.
 */
describe('DB span end-to-end — REST parents it under http.request, WS emits it standalone (OBS-02, T92)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let app: FastifyInstance;
  let wsUrl: string;
  let exporter: InMemorySpanExporter;
  let tracing: ReturnType<typeof createTracing>;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    exporter = new InMemorySpanExporter();
    tracing = createTracing({ exporter });

    const config = loadConfig({ NODE_ENV: 'test' });
    app = buildServer(config, { tracing });
    await registerAuthModule(app, { db, config });
    registerWorkspaceModule(app, { db });
    registerDiagramSyncModule(app, { db, tracing });
    await registerWsGatewayModule(app, { db, presence: new NullPresenceBroadcaster(), tracing });
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
    exporter.reset();
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
      payload: { name: `Tracing WS ${slug}`, slug: `tracing-int-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Tracing Project ${slug}` },
    });
    const projectId = createProject.json().project.id;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Tracing Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id as string };
  }

  it("a real REST operations:batch mutation emits db.append_operation as a CHILD of that request's own http.request span", async () => {
    const owner = await seedUserWithSession('tracing-rest');
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
    await tracing.provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const requestSpan = spans.find(
      (s) =>
        s.name === 'http.request' &&
        s.attributes['http.route'] === '/diagrams/:id/operations:batch',
    );
    const dbSpan = spans.find((s) => s.name === 'db.append_operation');

    expect(requestSpan).toBeDefined();
    expect(dbSpan).toBeDefined();
    expect(dbSpan?.spanContext().traceId).toBe(requestSpan?.spanContext().traceId);
    expect(dbSpan?.parentSpanContext?.spanId).toBe(requestSpan?.spanContext().spanId);
    expect(dbSpan?.attributes).toMatchObject({
      'diagram.id': diagramId,
      'operation.delta_count': 1,
    });
  });

  it('a real WS mutation emits a standalone db.append_operation span (no REST request to parent under — see WsGatewayModuleDeps.tracing doc comment)', async () => {
    const owner = await seedUserWithSession('tracing-ws');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'ws');
    exporter.reset();

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
    await tracing.provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const dbSpan = spans.find((s) => s.name === 'db.append_operation');
    expect(dbSpan).toBeDefined();
    expect(dbSpan?.parentSpanContext).toBeUndefined();
    expect(dbSpan?.attributes).toMatchObject({
      'diagram.id': diagramId,
      'operation.delta_count': 1,
    });
  });
});
