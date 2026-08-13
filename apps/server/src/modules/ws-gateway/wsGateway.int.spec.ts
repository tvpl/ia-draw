// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).
import { randomUUID } from 'node:crypto';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
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
import { NullPresenceBroadcaster } from './presence.js';
import { registerWsGatewayModule, WS_CLOSE_PAYLOAD_TOO_LARGE } from './routes.js';

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

describe('ws-gateway: /ws/diagrams/:diagramId (T73, CLB-01/02)', () => {
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
    registerDiagramSyncModule(app, { db });
    await registerWsGatewayModule(app, { db, presence: new NullPresenceBroadcaster() });
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
      payload: {
        name: `WS gateway ${slug}`,
        slug: `ws-gw-${slug}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const workspaceId = createWs.json().workspace.id;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `WS gateway project ${slug}` },
    });
    const projectId = createProject.json().project.id;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `WS gateway diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id as string };
  }

  async function issueTicket(cookies: Record<string, string>, diagramId: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/ws-ticket`,
      cookies,
    });
    expect(response.statusCode).toBe(200);
    return response.json().ticket as string;
  }

  function connect(diagramId: string, ticket: string): WebSocket {
    const socket = new WebSocket(
      `${wsUrl}/ws/diagrams/${diagramId}?ticket=${encodeURIComponent(ticket)}`,
    );
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

  function waitForClose(socket: WebSocket): Promise<{ code: number }> {
    return new Promise((resolve) => {
      socket.once('close', (code: number) => resolve({ code }));
    });
  }

  async function opRows(diagramId: string) {
    return db
      .select()
      .from(schema.diagramOperations)
      .where(eq(schema.diagramOperations.diagramId, diagramId));
  }

  it('a valid ticket is accepted and hello is received immediately', async () => {
    const owner = await seedUserWithSession('hello');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'hello');
    const ticket = await issueTicket(owner.cookies, diagramId);

    const socket = connect(diagramId, ticket);
    const hello = await waitForMessage(socket);

    expect(hello.type).toBe('hello');
    expect(hello.payload).toEqual({ userId: owner.user.id, diagramId });
  });

  it('an invalid ticket is rejected before the upgrade completes — hello is never sent', async () => {
    const owner = await seedUserWithSession('bad-ticket');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'bad-ticket');

    const socket = new WebSocket(`${wsUrl}/ws/diagrams/${diagramId}?ticket=not-a-real-ticket`);
    openSockets.push(socket);

    let helloReceived = false;
    socket.on('message', () => {
      helloReceived = true;
    });

    const failure = await new Promise<{ statusCode?: number }>((resolve) => {
      socket.on('unexpected-response', (_req, res) => {
        resolve({ statusCode: res.statusCode });
      });
      socket.on('error', () => resolve({}));
    });

    expect(failure.statusCode).toBe(401);
    expect(helloReceived).toBe(false);
  });

  it('an expired ticket is rejected the same way — never accepted then closed', async () => {
    const owner = await seedUserWithSession('expired-ticket');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'expired-ticket');
    const ticket = await issueTicket(owner.cookies, diagramId);

    // Force the just-issued ticket into the past, simulating expiry without waiting 30s.
    await db
      .update(schema.wsTickets)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.wsTickets.diagramId, diagramId));

    const socket = new WebSocket(
      `${wsUrl}/ws/diagrams/${diagramId}?ticket=${encodeURIComponent(ticket)}`,
    );
    openSockets.push(socket);

    let helloReceived = false;
    socket.on('message', () => {
      helloReceived = true;
    });

    const failure = await new Promise<{ statusCode?: number }>((resolve) => {
      socket.on('unexpected-response', (_req, res) => resolve({ statusCode: res.statusCode }));
      socket.on('error', () => resolve({}));
    });

    expect(failure.statusCode).toBe(401);
    expect(helloReceived).toBe(false);
  });

  it('a reused ticket is rejected on the second connection attempt', async () => {
    const owner = await seedUserWithSession('reused-ticket');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'reused-ticket');
    const ticket = await issueTicket(owner.cookies, diagramId);

    const first = connect(diagramId, ticket);
    await waitForMessage(first); // hello
    first.terminate();

    const second = new WebSocket(
      `${wsUrl}/ws/diagrams/${diagramId}?ticket=${encodeURIComponent(ticket)}`,
    );
    openSockets.push(second);
    const failure = await new Promise<{ statusCode?: number }>((resolve) => {
      second.on('unexpected-response', (_req, res) => resolve({ statusCode: res.statusCode }));
      second.on('error', () => resolve({}));
    });
    expect(failure.statusCode).toBe(401);
  });

  it('sync_request returns sync_state with the real diagram scene (same data the REST bootstrap would return)', async () => {
    const owner = await seedUserWithSession('sync');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'sync');

    await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies: owner.cookies,
      payload: {
        clientMutationId: randomUUID(),
        baseRevision: 0,
        actorId: owner.user.id,
        deltas: [rectangleDelta('el-sync-1')],
      },
    });

    const bootstrap = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/bootstrap`,
      cookies: owner.cookies,
    });
    const bootstrapBody = bootstrap.json();

    const ticket = await issueTicket(owner.cookies, diagramId);
    const socket = connect(diagramId, ticket);
    await waitForMessage(socket); // hello

    socket.send(JSON.stringify(envelope(diagramId, 'sync_request', {})));
    const syncState = await waitForMessage(socket);

    expect(syncState.type).toBe('sync_state');
    expect(syncState.payload.revision).toBe(bootstrapBody.revision);
    expect(syncState.payload.scene).toEqual(bootstrapBody.scene);
  });

  it('a mutation from a user with diagram:mutate is persisted via appendOperation and acked', async () => {
    const owner = await seedUserWithSession('mutate-owner');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'mutate-owner');
    const ticket = await issueTicket(owner.cookies, diagramId);
    const socket = connect(diagramId, ticket);
    await waitForMessage(socket); // hello

    const clientMutationId = randomUUID();
    socket.send(
      JSON.stringify(
        envelope(diagramId, 'mutation', {
          clientMutationId,
          baseRevision: 0,
          deltas: [rectangleDelta('el-mut-1')],
        }),
      ),
    );

    const ack = await waitForMessage(socket);
    expect(ack.type).toBe('mutation_ack');
    expect(ack.payload).toEqual({ clientMutationId, sequence: 1 });

    const rows = await opRows(diagramId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ clientMutationId, actorId: owner.user.id, sequence: 1 });
  });

  it.each(['reviewer', 'viewer'] as const)(
    'a mutation from a %s (no diagram:mutate) is mutation_rejected and nothing is persisted',
    async (role) => {
      const owner = await seedUserWithSession(`mutate-${role}-owner`);
      const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, `mutate-${role}`);
      const actor = await seedUserWithSession(`mutate-${role}-actor`);
      await db.insert(schema.workspaceMembers).values({ workspaceId, userId: actor.user.id, role });

      const ticket = await issueTicket(actor.cookies, diagramId);
      const socket = connect(diagramId, ticket);
      await waitForMessage(socket); // hello

      const clientMutationId = randomUUID();
      socket.send(
        JSON.stringify(
          envelope(diagramId, 'mutation', {
            clientMutationId,
            baseRevision: 0,
            deltas: [rectangleDelta('el-rbac-1')],
          }),
        ),
      );

      const rejection = await waitForMessage(socket);
      expect(rejection.type).toBe('mutation_rejected');
      expect(rejection.payload.clientMutationId).toBe(clientMutationId);

      const rows = await opRows(diagramId);
      expect(rows).toHaveLength(0);
    },
  );

  it('a frame above 256 KB is closed with a specific code and nothing is processed', async () => {
    const owner = await seedUserWithSession('oversized');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'oversized');
    const ticket = await issueTicket(owner.cookies, diagramId);
    const socket = connect(diagramId, ticket);
    await waitForMessage(socket); // hello

    const closePromise = waitForClose(socket);
    const oversizedPayload = 'x'.repeat(300 * 1024);
    socket.send(
      JSON.stringify(
        envelope(diagramId, 'mutation', {
          clientMutationId: randomUUID(),
          baseRevision: 0,
          deltas: [oversizedPayload],
        }),
      ),
    );

    const { code } = await closePromise;
    expect(code).toBe(WS_CLOSE_PAYLOAD_TOO_LARGE);

    const rows = await opRows(diagramId);
    expect(rows).toHaveLength(0);
  });

  it('a mid-session role downgrade rejects the very next mutation without a reconnect (AUTH-05)', async () => {
    const owner = await seedUserWithSession('downgrade-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'downgrade');
    const actor = await seedUserWithSession('downgrade-actor');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: actor.user.id, role: 'editor' });

    const ticket = await issueTicket(actor.cookies, diagramId);
    const socket = connect(diagramId, ticket);
    await waitForMessage(socket); // hello

    const firstClientMutationId = randomUUID();
    socket.send(
      JSON.stringify(
        envelope(diagramId, 'mutation', {
          clientMutationId: firstClientMutationId,
          baseRevision: 0,
          deltas: [rectangleDelta('el-downgrade-1')],
        }),
      ),
    );
    const firstAck = await waitForMessage(socket);
    expect(firstAck.type).toBe('mutation_ack');

    // Downgrade the actor's role on the SAME connection — no reconnect.
    await db
      .update(schema.workspaceMembers)
      .set({ role: 'viewer' })
      .where(eq(schema.workspaceMembers.userId, actor.user.id));

    const secondClientMutationId = randomUUID();
    socket.send(
      JSON.stringify(
        envelope(diagramId, 'mutation', {
          clientMutationId: secondClientMutationId,
          baseRevision: 1,
          deltas: [rectangleDelta('el-downgrade-2')],
        }),
      ),
    );
    const secondResult = await waitForMessage(socket);
    expect(secondResult.type).toBe('mutation_rejected');
    expect(secondResult.payload.clientMutationId).toBe(secondClientMutationId);

    const rows = await opRows(diagramId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.clientMutationId).toBe(firstClientMutationId);
  });

  it('ping is answered with pong', async () => {
    const owner = await seedUserWithSession('ping');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'ping');
    const ticket = await issueTicket(owner.cookies, diagramId);
    const socket = connect(diagramId, ticket);
    await waitForMessage(socket); // hello

    socket.send(JSON.stringify(envelope(diagramId, 'ping', {})));
    const pong = await waitForMessage(socket);
    expect(pong.type).toBe('pong');
  });
});
