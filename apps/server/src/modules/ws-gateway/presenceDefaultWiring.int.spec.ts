// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).
/**
 * Proves `ws-gateway` boots and works fully with `InMemoryPresenceBroadcaster` — the
 * AD-009 default when no `REDIS_URL`-equivalent config is supplied — injected in place
 * of T73's `NullPresenceBroadcaster` stub. `registerModules.ts`'s actual config-driven
 * selection between `InMemoryPresenceBroadcaster`/`RedisPresenceBroadcaster` is T81's
 * job (a later batch); this test only confirms the mutation/sync/ping flow `wsGateway.
 * int.spec.ts` already covers against `NullPresenceBroadcaster` behaves identically
 * once a real (non-Null) broadcaster is wired in, and that a `presence` message
 * flowing through a real `presence.publish()` call never destabilizes the connection.
 */
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

describe('ws-gateway boots and works fully without Redis (AD-009 default: InMemoryPresenceBroadcaster, T74)', () => {
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
    // The whole point of this file: a REAL broadcaster, not the Null stub.
    await registerWsGatewayModule(app, { db, presence: new InMemoryPresenceBroadcaster() });
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
        name: `WS gateway default-wiring ${slug}`,
        slug: `ws-gw-def-${slug}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const workspaceId = createWs.json().workspace.id;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `WS gateway default-wiring project ${slug}` },
    });
    const projectId = createProject.json().project.id;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `WS gateway default-wiring diagram ${slug}` },
    });
    return { diagramId: createDiagram.json().diagram.id as string };
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

  it('mutation is persisted and acked, and a presence message never destabilizes the connection', async () => {
    const owner = await seedUserWithSession('default-wiring');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'default-wiring');
    const ticket = await issueTicket(owner.cookies, diagramId);
    const socket = connect(diagramId, ticket);
    await waitForMessage(socket); // hello

    const clientMutationId = randomUUID();
    socket.send(
      JSON.stringify(
        envelope(diagramId, 'mutation', {
          clientMutationId,
          baseRevision: 0,
          deltas: [rectangleDelta('el-default-wiring-1')],
        }),
      ),
    );
    const ack = await waitForMessage(socket);
    expect(ack.type).toBe('mutation_ack');
    expect(ack.payload).toEqual({ clientMutationId, sequence: 1 });

    const rows = await db
      .select()
      .from(schema.diagramOperations)
      .where(eq(schema.diagramOperations.diagramId, diagramId));
    expect(rows).toHaveLength(1);

    // presence.publish() now runs against a REAL InMemoryPresenceBroadcaster (T74),
    // not a no-op — confirm it never throws/closes the socket as a side effect.
    socket.send(
      JSON.stringify(
        envelope(diagramId, 'presence', {
          cursor: { x: 10, y: 20 },
          selection: ['el-default-wiring-1'],
          status: 'active',
        }),
      ),
    );

    // The connection is still healthy: a subsequent ping still gets a pong.
    socket.send(JSON.stringify(envelope(diagramId, 'ping', {})));
    const pong = await waitForMessage(socket);
    expect(pong.type).toBe('pong');
  });
});
