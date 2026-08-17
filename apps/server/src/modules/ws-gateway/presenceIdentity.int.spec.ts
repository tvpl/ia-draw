// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved (AD-007).
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
import { InMemoryPresenceBroadcaster } from './presence.js';
import { registerWsGatewayModule } from './routes.js';

interface WsEnvelopeLike {
  type: string;
  payload: Record<string, unknown>;
}

/**
 * LIVE-01..04 (realtime-presence): the relay must carry the sender's identity.
 * Two REAL `ws` sockets on the same diagram, one `apps/server` process and the
 * default single-process `InMemoryPresenceBroadcaster` (AD-009) — the
 * cross-process variant is already covered by `crossInstancePresence.int.spec.ts`
 * and is not what these ACs are about.
 */
describe('ws-gateway: presence relay carries the sender identity (LIVE-01..04)', () => {
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

  async function seedUserWithSession(prefix: string, displayName: string) {
    const user = await createLocalAccount(db, {
      email: `${prefix}-${Date.now()}-${Math.random()}@example.com`,
      displayName,
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
        name: `Presence identity ${slug}`,
        slug: `pres-id-${slug}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const workspaceId = createWs.json().workspace.id;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Presence identity project ${slug}` },
    });
    const projectId = createProject.json().project.id;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Presence identity diagram ${slug}` },
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

  function collectMessages(socket: WebSocket, type: string, bucket: WsEnvelopeLike[]): void {
    socket.on('message', (data: Buffer) => {
      const parsed = JSON.parse(data.toString('utf8')) as WsEnvelopeLike;
      if (parsed.type === type) bucket.push(parsed);
    });
  }

  function presenceEnvelope(diagramId: string, payload: Record<string, unknown>) {
    return JSON.stringify({
      protocolVersion: 1,
      diagramId,
      messageId: randomUUID(),
      sentAt: new Date().toISOString(),
      type: 'presence',
      payload,
    });
  }

  async function seedPair(slug: string, ownerName: string, peerName: string) {
    const owner = await seedUserWithSession(`${slug}-owner`, ownerName);
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, slug);
    const peer = await seedUserWithSession(`${slug}-peer`, peerName);
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: peer.user.id, role: 'editor' });
    return { owner, peer, diagramId };
  }

  async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  it("relays A's presence to B carrying A's senderId and displayName (LIVE-01, LIVE-02)", async () => {
    const { owner, peer, diagramId } = await seedPair('relay', 'Ana Owner', 'Bruno Peer');

    const clientA = connect(diagramId, await issueTicket(owner.cookies, diagramId));
    await waitForMessage(clientA);
    const clientB = connect(diagramId, await issueTicket(peer.cookies, diagramId));
    await waitForMessage(clientB);

    const receivedOnB: WsEnvelopeLike[] = [];
    collectMessages(clientB, 'presence', receivedOnB);

    clientA.send(
      presenceEnvelope(diagramId, {
        cursor: { x: 12, y: 34 },
        selection: ['el-a'],
        status: 'active',
      }),
    );

    await waitUntil(() => receivedOnB.length > 0, "B to receive A's presence");
    expect(receivedOnB[0]?.payload).toEqual({
      cursor: { x: 12, y: 34 },
      selection: ['el-a'],
      status: 'active',
      senderId: owner.user.id,
      displayName: 'Ana Owner',
    });
  });

  it("never echoes a client's own presence back to itself (LIVE-03)", async () => {
    const { owner, peer, diagramId } = await seedPair('echo', 'Ana Echo', 'Bruno Echo');

    const clientA = connect(diagramId, await issueTicket(owner.cookies, diagramId));
    await waitForMessage(clientA);
    const clientB = connect(diagramId, await issueTicket(peer.cookies, diagramId));
    await waitForMessage(clientB);

    const receivedOnA: WsEnvelopeLike[] = [];
    const receivedOnB: WsEnvelopeLike[] = [];
    collectMessages(clientA, 'presence', receivedOnA);
    collectMessages(clientB, 'presence', receivedOnB);

    clientA.send(presenceEnvelope(diagramId, { cursor: { x: 1, y: 2 }, status: 'active' }));

    // B receiving is the happens-after marker that A's own relay pass already ran.
    await waitUntil(() => receivedOnB.length > 0, "B to receive A's presence");
    expect(receivedOnA).toEqual([]);
    expect(receivedOnB[0]?.payload.senderId).toBe(owner.user.id);
  });

  it('ignores a senderId and displayName supplied by the client, using the ticket actor (LIVE-04)', async () => {
    const { owner, peer, diagramId } = await seedPair('spoof', 'Ana Real', 'Bruno Spoof');
    const forgedId = randomUUID();

    const clientA = connect(diagramId, await issueTicket(owner.cookies, diagramId));
    await waitForMessage(clientA);
    const clientB = connect(diagramId, await issueTicket(peer.cookies, diagramId));
    await waitForMessage(clientB);

    const receivedOnB: WsEnvelopeLike[] = [];
    collectMessages(clientB, 'presence', receivedOnB);

    clientA.send(
      presenceEnvelope(diagramId, {
        cursor: { x: 7, y: 8 },
        status: 'active',
        senderId: forgedId,
        displayName: 'Someone Else',
      }),
    );

    await waitUntil(() => receivedOnB.length > 0, "B to receive A's presence");
    expect(receivedOnB[0]?.payload.senderId).toBe(owner.user.id);
    expect(receivedOnB[0]?.payload.senderId).not.toBe(forgedId);
    expect(receivedOnB[0]?.payload.displayName).toBe('Ana Real');
  });
});
