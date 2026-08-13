// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).
/**
 * T77 (CLB-03/04) — node-restart durability, explicitly WITHOUT Redis.
 *
 * Simulates a node restart: an "old" `FastifyInstance` accepts a WS
 * connection, persists two mutations, then is closed and DISCARDED
 * entirely (no reference to it, its `InMemoryPresenceBroadcaster`, or any
 * of its in-memory connection state survives). A brand-new `FastifyInstance`
 * — a fresh `registerWsGatewayModule` call with its OWN, brand-new
 * `InMemoryPresenceBroadcaster` — is then built pointing at the SAME
 * underlying Postgres (PGlite) database the old instance had already
 * written to. This whole file never constructs a `RedisPresenceBroadcaster`
 * and never reads/sets anything resembling a `REDIS_URL` — the entire
 * durability path this test proves runs with zero Redis dependency, per
 * AD-009's explicit commitment that presence (never persisted, CLB-04) can
 * vanish across a restart without risking a single byte of durable content
 * (CLB-03).
 */
import { randomUUID } from 'node:crypto';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { loadConfig } from '../../core/config.js';
import { buildServer } from '../../core/server.js';
import { createLocalAccount } from '../auth/accounts.js';
import { SESSION_COOKIE_NAME } from '../auth/cookie.js';
import { registerAuthModule } from '../auth/routes.js';
import { createSession } from '../auth/session.js';
import { registerDiagramSyncModule } from '../diagram-sync/routes.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { InMemoryPresenceBroadcaster } from './presence.js';
import { registerWsGatewayModule } from './routes.js';

interface WsEnvelopeLike {
  type: string;
  payload: Record<string, unknown> & { [key: string]: unknown };
}

function envelope(diagramId: string, type: string, payload: unknown) {
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

function elementIds(scene: unknown): string[] {
  return (scene as Array<{ id: string }>).map((element) => element.id).sort();
}

/** Boots a fresh `FastifyInstance` with its own brand-new `InMemoryPresenceBroadcaster` against `db` — deliberately NO `RedisPresenceBroadcaster`, no `REDIS_URL`-equivalent config anywhere. */
async function bootInstance(db: PgliteDatabase<typeof schema>): Promise<{
  app: FastifyInstance;
  wsUrl: string;
}> {
  const config = loadConfig({ NODE_ENV: 'test' });
  const app = buildServer(config);
  await registerAuthModule(app, { db, config });
  registerWorkspaceModule(app, { db });
  registerDiagramSyncModule(app, { db });
  await registerWsGatewayModule(app, { db, presence: new InMemoryPresenceBroadcaster() });
  await app.listen({ port: 0, host: '127.0.0.1' });

  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('expected a bound TCP address');
  return { app, wsUrl: `ws://127.0.0.1:${address.port}` };
}

async function seedUserWithSession(db: PgliteDatabase<typeof schema>, prefix: string) {
  const user = await createLocalAccount(db, {
    email: `${prefix}-${Date.now()}-${Math.random()}@example.com`,
    displayName: prefix,
    password: `${prefix}-password`,
  });
  const session = await createSession(db, user.id);
  return { user, cookies: { [SESSION_COOKIE_NAME]: session.token } };
}

async function seedDiagramAs(app: FastifyInstance, cookies: Record<string, string>, slug: string) {
  const createWs = await app.inject({
    method: 'POST',
    url: '/workspaces',
    cookies,
    payload: {
      name: `Restart durability ${slug}`,
      slug: `restart-${slug}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  });
  const workspaceId = createWs.json().workspace.id;

  const createProject = await app.inject({
    method: 'POST',
    url: '/projects',
    cookies,
    payload: { workspaceId, name: `Restart durability project ${slug}` },
  });
  const projectId = createProject.json().project.id;

  const createDiagram = await app.inject({
    method: 'POST',
    url: '/diagrams',
    cookies,
    payload: { projectId, title: `Restart durability diagram ${slug}` },
  });
  return { workspaceId, diagramId: createDiagram.json().diagram.id as string };
}

async function issueTicket(
  app: FastifyInstance,
  cookies: Record<string, string>,
  diagramId: string,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: `/diagrams/${diagramId}/ws-ticket`,
    cookies,
  });
  expect(response.statusCode).toBe(200);
  return response.json().ticket as string;
}

function waitForMessage(socket: WebSocket): Promise<WsEnvelopeLike> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data: Buffer) => {
      try {
        resolve(JSON.parse(data.toString('utf8')));
      } catch (error) {
        reject(error);
      }
    });
    socket.once('error', reject);
  });
}

describe('ws-gateway: node-restart durability without Redis (T77, CLB-03/04)', () => {
  let pglite: PGlite;
  let db: PgliteDatabase<typeof schema>;

  beforeAll(async () => {
    pglite = new PGlite();
    db = drizzle(pglite, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });
  });

  const openSockets: WebSocket[] = [];
  const openApps: FastifyInstance[] = [];
  afterEach(async () => {
    for (const socket of openSockets.splice(0)) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.terminate();
      }
    }
    for (const app of openApps.splice(0)) {
      await app.close();
    }
    await pglite.close();
  });

  it('a fresh node (no Redis, zero in-memory state) reconstructs the full scene from Postgres alone, and keeps working', async () => {
    // --- "Old" instance: writes durable content, then is discarded. ---
    const oldInstance = await bootInstance(db);
    openApps.push(oldInstance.app);

    const owner = await seedUserWithSession(db, 'restart-owner');
    const { diagramId } = await seedDiagramAs(oldInstance.app, owner.cookies, 'restart');

    const oldTicket = await issueTicket(oldInstance.app, owner.cookies, diagramId);
    const oldSocket = new WebSocket(
      `${oldInstance.wsUrl}/ws/diagrams/${diagramId}?ticket=${encodeURIComponent(oldTicket)}`,
    );
    openSockets.push(oldSocket);
    await waitForMessage(oldSocket); // hello

    const ackOne = waitForMessage(oldSocket);
    oldSocket.send(
      JSON.stringify(
        envelope(diagramId, 'mutation', {
          clientMutationId: randomUUID(),
          baseRevision: 0,
          deltas: [rectangleDelta('el-durable-1')],
        }),
      ),
    );
    expect((await ackOne).type).toBe('mutation_ack');

    const ackTwo = waitForMessage(oldSocket);
    oldSocket.send(
      JSON.stringify(
        envelope(diagramId, 'mutation', {
          clientMutationId: randomUUID(),
          baseRevision: 1,
          deltas: [rectangleDelta('el-durable-2')],
        }),
      ),
    );
    const secondAck = await ackTwo;
    expect(secondAck.type).toBe('mutation_ack');
    const revisionBeforeRestart = secondAck.payload.sequence as number;

    // The state a client would need to lose to prove non-durability: read
    // it directly from Postgres before the "restart", independent of any
    // in-memory app state.
    const opsBeforeRestart = await db
      .select()
      .from(schema.diagramOperations)
      .where(eq(schema.diagramOperations.diagramId, diagramId));
    expect(opsBeforeRestart).toHaveLength(2);

    // --- Simulate a node restart: terminate the socket, close the OLD
    // instance entirely, drop every reference to it (its
    // InMemoryPresenceBroadcaster included). Nothing here survives except
    // `db` (the same underlying Postgres a real restarted process would
    // still be able to reach). ---
    oldSocket.terminate();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await oldInstance.app.close();
    openApps.splice(openApps.indexOf(oldInstance.app), 1);

    // --- "New" instance: fresh FastifyInstance, brand-new
    // InMemoryPresenceBroadcaster (zero shared state with the old one), NO
    // Redis anywhere, same `db`. ---
    const newInstance = await bootInstance(db);
    openApps.push(newInstance.app);

    const newTicket = await issueTicket(newInstance.app, owner.cookies, diagramId);
    const newSocket = new WebSocket(
      `${newInstance.wsUrl}/ws/diagrams/${diagramId}?ticket=${encodeURIComponent(newTicket)}`,
    );
    openSockets.push(newSocket);
    await waitForMessage(newSocket); // hello

    newSocket.send(JSON.stringify(envelope(diagramId, 'sync_request', {})));
    const syncState = await waitForMessage(newSocket);
    expect(syncState.type).toBe('sync_state');

    // CLB-03: zero durable content lost — both elements the old instance
    // persisted are still there, reconstructed purely from Postgres.
    expect(elementIds(syncState.payload.scene)).toEqual(['el-durable-1', 'el-durable-2']);
    expect(syncState.payload.revision).toBe(revisionBeforeRestart);

    // CLB-04: losing presence (nothing "remembers" the old socket/actor —
    // trivially true, presence was never persisted) never turns the new
    // instance into an accidental read-only node — mutations still work.
    const ackThree = waitForMessage(newSocket);
    newSocket.send(
      JSON.stringify(
        envelope(diagramId, 'mutation', {
          clientMutationId: randomUUID(),
          baseRevision: syncState.payload.revision as number,
          deltas: [rectangleDelta('el-after-restart')],
        }),
      ),
    );
    const thirdAck = await ackThree;
    expect(thirdAck.type).toBe('mutation_ack');

    const opsAfterRestart = await db
      .select()
      .from(schema.diagramOperations)
      .where(eq(schema.diagramOperations.diagramId, diagramId));
    expect(opsAfterRestart).toHaveLength(3);
    // The two pre-restart operations are still present, byte-for-byte, plus
    // exactly one new one from the post-restart mutation.
    const preRestartIds = new Set(opsBeforeRestart.map((op) => op.clientMutationId));
    const afterRestartIds = opsAfterRestart.map((op) => op.clientMutationId);
    expect(afterRestartIds.filter((id) => preRestartIds.has(id))).toHaveLength(2);
    expect(afterRestartIds.filter((id) => !preRestartIds.has(id))).toHaveLength(1);
  });
});
