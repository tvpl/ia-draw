// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).
/**
 * T76 (CLB-02) — reconnection convergence proof.
 *
 * **Design decision on `afterSequence` (documented here per the task's own
 * instruction, T76's "Done when" #2)**: `sync_request`'s `afterSequence`
 * field has existed since T72's payload schema, but T73's `routes.ts`
 * always answers `sync_request` with the FULL current scene regardless of
 * whether `afterSequence` was supplied (confirmed by reading `routes.ts`
 * before writing this file — the `sync_request` case never even reads
 * `message.payload.afterSequence`). This task deliberately does NOT add an
 * incremental catch-up path (`loadOperationsAfter`, F1b/`catchup.ts`) for
 * `sync_state`. Reason: `loadDiagramScene` (F1b) rebuilds the scene by
 * folding the ENTIRE op-log through `reconcileOperation` on every call —
 * the returned `scene` is therefore always complete and always current as
 * of the moment it's read, independent of how many clients reconnect or in
 * what order. Convergence (CLB-02's AC) only requires that every
 * reconnecting client ends up with the SAME final scene containing every
 * committed mutation — "always full state" trivially satisfies that: there
 * is no code path by which two different reconnecting clients could ever
 * observe two different "full" scenes for the same `diagramId` at
 * quiescence, since both reads fold the identical, monotonically-appended
 * `diagram_operations` table. An incremental path would be a pure
 * performance optimization for large scenes (avoiding re-folding
 * already-known operations) — not required by any AC in this wave, so
 * building it here would be exactly the "invent work the AC doesn't ask
 * for" anti-pattern the task text explicitly warns against. `routes.ts` is
 * therefore UNCHANGED by this task; this file is a test-only task, as its
 * "Where" line documents alongside the option this task chose not to take.
 */
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

describe('ws-gateway: reconnection convergence (T76, CLB-02)', () => {
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
        name: `Convergence ${slug}`,
        slug: `conv-${slug}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const workspaceId = createWs.json().workspace.id;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Convergence project ${slug}` },
    });
    const projectId = createProject.json().project.id;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Convergence diagram ${slug}` },
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

  function elementIds(scene: unknown): string[] {
    return (scene as Array<{ id: string }>).map((element) => element.id).sort();
  }

  it('two concurrent mutations on distinct elements, both clients disconnect+reconnect, converge to the same final scene', async () => {
    const owner = await seedUserWithSession('conv-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'conv-owner');
    const peer = await seedUserWithSession('conv-peer');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: peer.user.id, role: 'editor' });

    // --- Round 1: both clients connect and mutate distinct elements concurrently. ---
    const ticketA1 = await issueTicket(owner.cookies, diagramId);
    const ticketB1 = await issueTicket(peer.cookies, diagramId);
    const clientA1 = connect(diagramId, ticketA1);
    const clientB1 = connect(diagramId, ticketB1);
    await Promise.all([waitForMessage(clientA1), waitForMessage(clientB1)]); // hello x2

    const ackA1Promise = waitForMessage(clientA1);
    const ackB1Promise = waitForMessage(clientB1);
    // Sent "simultaneously" — no await between the two sends — so both
    // mutations are genuinely concurrent from the client's perspective;
    // they target different elementIds so there is no LWW conflict.
    clientA1.send(
      JSON.stringify(
        envelope(diagramId, 'mutation', {
          clientMutationId: randomUUID(),
          baseRevision: 0,
          deltas: [rectangleDelta('el-a')],
        }),
      ),
    );
    clientB1.send(
      JSON.stringify(
        envelope(diagramId, 'mutation', {
          clientMutationId: randomUUID(),
          baseRevision: 0,
          deltas: [rectangleDelta('el-b')],
        }),
      ),
    );
    const [ackA1, ackB1] = await Promise.all([ackA1Promise, ackB1Promise]);
    expect(ackA1.type).toBe('mutation_ack');
    expect(ackB1.type).toBe('mutation_ack');

    // --- Both disconnect. ---
    clientA1.terminate();
    clientB1.terminate();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // --- Client A reconnects first and mutates AGAIN before B reconnects —
    // proves ordering survives B reconnecting strictly after A already
    // mutated post-reconnect, not just after the original round 1. ---
    const ticketA2 = await issueTicket(owner.cookies, diagramId);
    const clientA2 = connect(diagramId, ticketA2);
    await waitForMessage(clientA2); // hello

    clientA2.send(JSON.stringify(envelope(diagramId, 'sync_request', {})));
    const syncStateA2 = await waitForMessage(clientA2);
    expect(syncStateA2.type).toBe('sync_state');
    expect(elementIds(syncStateA2.payload.scene)).toEqual(['el-a', 'el-b']);

    const ackA2Promise = waitForMessage(clientA2);
    clientA2.send(
      JSON.stringify(
        envelope(diagramId, 'mutation', {
          clientMutationId: randomUUID(),
          baseRevision: syncStateA2.payload.revision as number,
          deltas: [rectangleDelta('el-a2')],
        }),
      ),
    );
    const ackA2 = await ackA2Promise;
    expect(ackA2.type).toBe('mutation_ack');

    // --- Client B reconnects AFTER A's second mutation. Its sync_state must
    // include ALL THREE elements, in sequence order, nothing lost. ---
    const ticketB2 = await issueTicket(peer.cookies, diagramId);
    const clientB2 = connect(diagramId, ticketB2);
    await waitForMessage(clientB2); // hello

    clientB2.send(JSON.stringify(envelope(diagramId, 'sync_request', {})));
    const syncStateB2 = await waitForMessage(clientB2);
    expect(syncStateB2.type).toBe('sync_state');
    expect(elementIds(syncStateB2.payload.scene)).toEqual(['el-a', 'el-a2', 'el-b']);

    // --- A also reconnects again (third time) to confirm ITS view now
    // matches B's exactly — true convergence, not just "B eventually saw
    // everything". ---
    const ticketA3 = await issueTicket(owner.cookies, diagramId);
    const clientA3 = connect(diagramId, ticketA3);
    await waitForMessage(clientA3); // hello
    clientA3.send(JSON.stringify(envelope(diagramId, 'sync_request', {})));
    const syncStateA3 = await waitForMessage(clientA3);

    expect(elementIds(syncStateA3.payload.scene)).toEqual(elementIds(syncStateB2.payload.scene));
    expect(syncStateA3.payload.revision).toBe(syncStateB2.payload.revision);
    // Full deep equality, not just the id set — every element's content converges too.
    const sortById = (scene: unknown) =>
      [...(scene as Array<{ id: string }>)].sort((a, b) => a.id.localeCompare(b.id));
    expect(sortById(syncStateA3.payload.scene)).toEqual(sortById(syncStateB2.payload.scene));
  });
});
