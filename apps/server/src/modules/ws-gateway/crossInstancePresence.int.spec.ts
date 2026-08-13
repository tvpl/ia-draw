// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).
/**
 * T75 (CLB-01) — the actual "collaboration is cross-node" proof: TWO real,
 * independently listening `FastifyInstance`s (two separate
 * `registerWsGatewayModule` calls, two separate ports), each with its OWN
 * `RedisPresenceBroadcaster` instance, both pointed at the SAME real
 * `redis-server` process spawned for this file — never mocked, per AD-009.
 * A real `ws` client connects to instance A, another real `ws` client
 * connects to instance B, both on the same `diagramId`. Client A sends a
 * `presence` message; instance A's `RedisPresenceBroadcaster.publish` goes
 * out over Redis `PUBLISH`, instance B's own `RedisPresenceBroadcaster`
 * (a completely separate Node process's worth of state, in the same test
 * process only because Vitest doesn't fork — the two `FastifyInstance`s
 * share nothing but the Redis connection string and the PGlite `db` handle)
 * receives it via `SUBSCRIBE` and `routes.ts`'s per-connection
 * `presence.subscribe` relay (added by this task — see the Status note in
 * `tasks-f4.md` for why `routes.ts` needed a small addition here) forwards
 * it out over client B's real WebSocket. This is the "second real process,
 * not just T74's contract test" the task explicitly asks for.
 *
 * Also proves the negative case: presence published on a DIFFERENT
 * `diagramId` never reaches a connection watching a different diagram, even
 * across the two instances.
 */
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { loadConfig } from '../../core/config.js';
import { buildServer } from '../../core/server.js';
import { createLocalAccount } from '../auth/accounts.js';
import { SESSION_COOKIE_NAME } from '../auth/cookie.js';
import { registerAuthModule } from '../auth/routes.js';
import { createSession } from '../auth/session.js';
import { registerDiagramSyncModule } from '../diagram-sync/routes.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { RedisPresenceBroadcaster } from './redisPresence.js';
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRedisReady(port: number): boolean {
  try {
    const out = execFileSync('redis-cli', ['-p', String(port), 'ping'], {
      encoding: 'utf8',
      timeout: 1_000,
    });
    return out.trim() === 'PONG';
  } catch {
    return false;
  }
}

async function waitForRedisReady(port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isRedisReady(port)) return;
    await sleep(100);
  }
  throw new Error(`redis-server on port ${port} did not answer PING within ${timeoutMs}ms`);
}

describe('ws-gateway: cross-instance presence propagation over real Redis (T75, CLB-01)', () => {
  let redisProcess: ChildProcess;
  let redisUrl: string;

  let pglite: PGlite;
  let db: PgliteDatabase<typeof schema>;

  let appA: FastifyInstance;
  let appB: FastifyInstance;
  let wsUrlA: string;
  let wsUrlB: string;
  let presenceA: RedisPresenceBroadcaster;
  let presenceB: RedisPresenceBroadcaster;

  beforeAll(async () => {
    const redisPort = 22_000 + ((process.pid + Math.floor(Math.random() * 9_000)) % 9_000);
    redisUrl = `redis://127.0.0.1:${redisPort}`;
    redisProcess = spawn(
      'redis-server',
      [
        '--port',
        String(redisPort),
        '--bind',
        '127.0.0.1',
        '--save',
        '',
        '--appendonly',
        'no',
        '--daemonize',
        'no',
      ],
      { stdio: 'ignore' },
    );
    await waitForRedisReady(redisPort);

    pglite = new PGlite();
    db = drizzle(pglite, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const config = loadConfig({ NODE_ENV: 'test' });

    presenceA = new RedisPresenceBroadcaster(redisUrl);
    appA = buildServer(config);
    await registerAuthModule(appA, { db, config });
    registerWorkspaceModule(appA, { db });
    registerDiagramSyncModule(appA, { db });
    await registerWsGatewayModule(appA, { db, presence: presenceA });
    await appA.listen({ port: 0, host: '127.0.0.1' });
    const addressA = appA.server.address();
    if (!addressA || typeof addressA === 'string') throw new Error('expected bound TCP address A');
    wsUrlA = `ws://127.0.0.1:${addressA.port}`;

    presenceB = new RedisPresenceBroadcaster(redisUrl);
    appB = buildServer(config);
    await registerAuthModule(appB, { db, config });
    registerWorkspaceModule(appB, { db });
    registerDiagramSyncModule(appB, { db });
    await registerWsGatewayModule(appB, { db, presence: presenceB });
    await appB.listen({ port: 0, host: '127.0.0.1' });
    const addressB = appB.server.address();
    if (!addressB || typeof addressB === 'string') throw new Error('expected bound TCP address B');
    wsUrlB = `ws://127.0.0.1:${addressB.port}`;
  }, 30_000);

  afterAll(async () => {
    await appA.close();
    await appB.close();
    await presenceA.close();
    await presenceB.close();
    await pglite.close();

    if (redisProcess) {
      await new Promise<void>((resolve) => {
        if (redisProcess.exitCode !== null) {
          resolve();
          return;
        }
        redisProcess.once('exit', () => resolve());
        redisProcess.kill('SIGTERM');
        setTimeout(resolve, 2_000);
      });
    }
  }, 30_000);

  const openSockets: WebSocket[] = [];
  afterEach(() => {
    for (const socket of openSockets.splice(0)) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.terminate();
      }
    }
  });

  async function seedUserWithSession(app: FastifyInstance, prefix: string) {
    const user = await createLocalAccount(db, {
      email: `${prefix}-${Date.now()}-${Math.random()}@example.com`,
      displayName: prefix,
      password: `${prefix}-password`,
    });
    const session = await createSession(db, user.id);
    return { user, cookies: { [SESSION_COOKIE_NAME]: session.token } };
  }

  async function seedDiagram(owner: { cookies: Record<string, string> }, slug: string) {
    const createWs = await appA.inject({
      method: 'POST',
      url: '/workspaces',
      cookies: owner.cookies,
      payload: {
        name: `Cross-instance ${slug}`,
        slug: `xinst-${slug}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const workspaceId = createWs.json().workspace.id;

    const createProject = await appA.inject({
      method: 'POST',
      url: '/projects',
      cookies: owner.cookies,
      payload: { workspaceId, name: `Cross-instance project ${slug}` },
    });
    const projectId = createProject.json().project.id;

    const createDiagram = await appA.inject({
      method: 'POST',
      url: '/diagrams',
      cookies: owner.cookies,
      payload: { projectId, title: `Cross-instance diagram ${slug}` },
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

  function connect(base: string, diagramId: string, ticket: string): WebSocket {
    const socket = new WebSocket(`${base}/ws/diagrams/${diagramId}?ticket=${encodeURIComponent(ticket)}`);
    openSockets.push(socket);
    return socket;
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

  /** Collects every message received on `socket` from now on into `bucket`, filtering to `type`. */
  function collectMessages(socket: WebSocket, type: string, bucket: WsEnvelopeLike[]): void {
    socket.on('message', (data: Buffer) => {
      const parsed = JSON.parse(data.toString('utf8')) as WsEnvelopeLike;
      if (parsed.type === type) bucket.push(parsed);
    });
  }

  it('presence published by a client on instance A reaches a client on instance B (real Redis, 2 processes)', async () => {
    const owner = await seedUserWithSession(appA, 'xinst-owner');
    const { workspaceId, diagramId } = await seedDiagram(owner, 'positive');
    const peer = await seedUserWithSession(appA, 'xinst-peer');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: peer.user.id, role: 'viewer' });

    const ticketA = await issueTicket(appA, owner.cookies, diagramId);
    const ticketB = await issueTicket(appB, peer.cookies, diagramId);

    const clientA = connect(wsUrlA, diagramId, ticketA);
    await waitForMessage(clientA); // hello

    const clientB = connect(wsUrlB, diagramId, ticketB);
    await waitForMessage(clientB); // hello

    const receivedOnB: WsEnvelopeLike[] = [];
    collectMessages(clientB, 'presence', receivedOnB);

    const marker = randomUUID();
    // Redis SUBSCRIBE (issued by instance B's RedisPresenceBroadcaster when
    // clientB's connection handler subscribed) is an async network round
    // trip — retry the publish from client A until B has observed it,
    // exactly like presenceBroadcaster.int.spec.ts's own real-Redis tests.
    const deadline = Date.now() + 10_000;
    while (receivedOnB.length === 0) {
      if (Date.now() > deadline) {
        throw new Error('presence never propagated from instance A to instance B within 10s');
      }
      clientA.send(
        JSON.stringify(
          envelope(diagramId, 'presence', {
            cursor: { x: 1, y: 2 },
            selection: [marker],
            status: 'active',
          }),
        ),
      );
      await sleep(100);
    }

    expect(receivedOnB.length).toBeGreaterThan(0);
    for (const message of receivedOnB) {
      expect(message.payload.selection).toEqual([marker]);
      expect(message.payload.status).toBe('active');
    }
  }, 20_000);

  it('presence published on a DIFFERENT diagramId never leaks across instances', async () => {
    const ownerX = await seedUserWithSession(appA, 'xinst-leak-owner-x');
    const { workspaceId: wsX, diagramId: diagramX } = await seedDiagram(ownerX, 'leak-x');
    const peerX = await seedUserWithSession(appA, 'xinst-leak-peer-x');
    await db.insert(schema.workspaceMembers).values({ workspaceId: wsX, userId: peerX.user.id, role: 'viewer' });

    const ownerY = await seedUserWithSession(appA, 'xinst-leak-owner-y');
    const { diagramId: diagramY } = await seedDiagram(ownerY, 'leak-y');

    const ticketX = await issueTicket(appA, ownerX.cookies, diagramX);
    const ticketWatcherX = await issueTicket(appB, peerX.cookies, diagramX);
    const ticketY = await issueTicket(appB, ownerY.cookies, diagramY);

    // Watcher connects on instance B, watching diagram X.
    const watcher = connect(wsUrlB, diagramX, ticketWatcherX);
    await waitForMessage(watcher); // hello
    const receivedOnWatcher: WsEnvelopeLike[] = [];
    collectMessages(watcher, 'presence', receivedOnWatcher);

    // A confirmed-working control publish on diagram X (same pattern as the
    // positive test) — proves the watcher's subscription is genuinely live
    // before we rely on its silence as a negative signal.
    const clientX = connect(wsUrlA, diagramX, ticketX);
    await waitForMessage(clientX); // hello
    const controlMarker = randomUUID();
    const controlDeadline = Date.now() + 10_000;
    while (receivedOnWatcher.length === 0) {
      if (Date.now() > controlDeadline) {
        throw new Error('control publish on diagram X never reached the watcher within 10s');
      }
      clientX.send(
        JSON.stringify(
          envelope(diagramX, 'presence', { selection: [controlMarker], status: 'active' }),
        ),
      );
      await sleep(100);
    }
    receivedOnWatcher.length = 0; // reset — only the diagram-Y leak check matters below

    // Now publish on diagram Y from instance B directly — the watcher (on
    // diagram X, instance B) must NEVER see it.
    const clientY = connect(wsUrlB, diagramY, ticketY);
    await waitForMessage(clientY); // hello
    for (let i = 0; i < 5; i += 1) {
      clientY.send(
        JSON.stringify(
          envelope(diagramY, 'presence', { selection: [randomUUID()], status: 'active' }),
        ),
      );
      await sleep(100);
    }

    expect(receivedOnWatcher).toHaveLength(0);
  }, 20_000);
});
