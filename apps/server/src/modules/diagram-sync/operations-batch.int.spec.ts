// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).

import { randomUUID } from 'node:crypto';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import type { SceneElement } from '@arch-canvas/editor-adapter';
import { allFixtures } from '@arch-canvas/test-fixtures';
import { PGlite } from '@electric-sql/pglite';
import { asc, eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../core/config.js';
import { buildServer } from '../../core/server.js';
import { createLocalAccount } from '../auth/accounts.js';
import { SESSION_COOKIE_NAME } from '../auth/cookie.js';
import type { Db } from '../auth/db.js';
import { registerAuthModule } from '../auth/routes.js';
import { createSession } from '../auth/session.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { registerDiagramSyncModule } from './routes.js';
import { loadDiagramScene } from './scene.js';

describe('POST /diagrams/:id/operations:batch (T22, EDT-03/04, REC-03/05)', () => {
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
      payload: { name: `Batch WS ${slug}`, slug: `batch-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Batch Project ${slug}` },
    });
    const projectId = createProject.json().project.id;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Batch Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id };
  }

  function envelope(
    actorId: string,
    clientMutationId: string,
    baseRevision: number,
    elementId: string,
    version: number,
    versionNonce: number,
  ) {
    return {
      clientMutationId,
      baseRevision,
      actorId,
      deltas: [
        {
          elementId,
          kind: 'upsert' as const,
          element: { id: elementId, type: 'rectangle', version, versionNonce },
          version,
          versionNonce,
        },
      ],
    };
  }

  async function opRows(diagramId: string) {
    return db
      .select()
      .from(schema.diagramOperations)
      .where(eq(schema.diagramOperations.diagramId, diagramId))
      .orderBy(asc(schema.diagramOperations.sequence));
  }

  it('a valid batch is persisted and acked with sequence 1 / currentRevision 1', async () => {
    const owner = await seedUserWithSession('batch-happy');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'happy');
    const clientMutationId = randomUUID();

    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies: owner.cookies,
      payload: envelope(owner.user.id, clientMutationId, 0, 'el-1', 1, 1),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.acks).toEqual([{ clientMutationId, sequence: 1 }]);
    expect(body.rejected).toEqual([]);
    expect(body.currentRevision).toBe(1);

    const rows = await opRows(diagramId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sequence: 1,
      clientMutationId,
      actorId: owner.user.id,
    });
  });

  it('resubmitting the same clientMutationId persists exactly one row and re-acks idempotently (EDT-04)', async () => {
    const owner = await seedUserWithSession('batch-idempotent');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'idempotent');
    const payload = envelope(owner.user.id, randomUUID(), 0, 'el-1', 1, 1);

    const first = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies: owner.cookies,
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies: owner.cookies,
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().acks).toEqual(second.json().acks);

    const rows = await opRows(diagramId);
    expect(rows).toHaveLength(1);
  });

  it('a simulated database write failure never acks (never 2xx) and persists nothing (REC-03)', async () => {
    const owner = await seedUserWithSession('batch-db-failure');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'db-failure');

    // A db handle whose transaction() always rejects, simulating "PostgreSQL
    // unavailable during batch" (design.md Error Handling Strategy). Every
    // other method (select/insert used by RBAC/idempotency checks) delegates
    // to the real PGlite db.
    const brokenDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'transaction') {
          return async () => {
            throw new Error('simulated database write failure');
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as Db;

    const brokenApp = buildServer(loadConfig({ NODE_ENV: 'test' }));
    await registerAuthModule(brokenApp, { db: brokenDb, config: loadConfig({ NODE_ENV: 'test' }) });
    registerWorkspaceModule(brokenApp, { db: brokenDb });
    registerDiagramSyncModule(brokenApp, { db: brokenDb });
    await brokenApp.ready();

    try {
      const response = await brokenApp.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/operations:batch`,
        cookies: owner.cookies,
        payload: envelope(owner.user.id, randomUUID(), 0, 'el-1', 1, 1),
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(500);
      expect(response.statusCode).toBeLessThan(600);
    } finally {
      await brokenApp.close();
    }

    const rows = await opRows(diagramId);
    expect(rows).toHaveLength(0);
  });

  it('the ack response never resolves before the transaction has actually committed (EDT-03)', async () => {
    const owner = await seedUserWithSession('batch-ack-timing');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'ack-timing');

    let releaseCommit: (() => void) | undefined;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });

    const slowDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'transaction') {
          const real = Reflect.get(target, prop, receiver) as typeof db.transaction;
          return async (fn: Parameters<typeof db.transaction>[0]) => {
            const result = await real.call(target, fn);
            // The row is already committed by `real.call` above (PGlite has no
            // separate "commit" step to delay independently) — this gate instead
            // proves the HTTP response cannot be observed until the caller's
            // promise resolves, which happens strictly after this point.
            await commitGate;
            return result;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as Db;

    const slowApp = buildServer(loadConfig({ NODE_ENV: 'test' }));
    const cfg = loadConfig({ NODE_ENV: 'test' });
    await registerAuthModule(slowApp, { db: slowDb, config: cfg });
    registerWorkspaceModule(slowApp, { db: slowDb });
    registerDiagramSyncModule(slowApp, { db: slowDb });
    await slowApp.ready();

    try {
      const pending = slowApp.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/operations:batch`,
        cookies: owner.cookies,
        payload: envelope(owner.user.id, randomUUID(), 0, 'el-1', 1, 1),
      });

      // Give the request a chance to reach (and block on) the gate.
      await new Promise((resolve) => setTimeout(resolve, 20));

      // The row IS already committed at this point (see comment above) — what this
      // test actually proves is the inverse-safe direction: the response promise
      // has NOT resolved yet, so no caller can have observed an ack.
      let resolved = false;
      pending.then(() => {
        resolved = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(resolved).toBe(false);

      releaseCommit?.();
      const response = await pending;
      expect(response.statusCode).toBe(200);
      expect(resolved).toBe(true);
    } finally {
      await slowApp.close();
    }
  });

  it('reviewer and viewer receive 403 attempting to mutate (never persisted)', async () => {
    const owner = await seedUserWithSession('batch-rbac-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'rbac');

    for (const role of ['reviewer', 'viewer'] as const) {
      const actor = await seedUserWithSession(`batch-rbac-${role}`);
      await db.insert(schema.workspaceMembers).values({ workspaceId, userId: actor.user.id, role });

      const response = await app.inject({
        method: 'POST',
        url: `/diagrams/${diagramId}/operations:batch`,
        cookies: actor.cookies,
        payload: envelope(actor.user.id, randomUUID(), 0, 'el-1', 1, 1),
      });

      expect(response.statusCode).toBe(403);
    }

    const rows = await opRows(diagramId);
    expect(rows).toHaveLength(0);
  });

  it('a malformed envelope (missing clientMutationId) is rejected with a client error, not persisted', async () => {
    const owner = await seedUserWithSession('batch-malformed');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'malformed');

    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies: owner.cookies,
      payload: { baseRevision: 0, actorId: owner.user.id, deltas: [] },
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
  });

  it('a stale baseRevision is never auto-rejected — the batch is accepted and missing operations are reported (client reconciles)', async () => {
    const owner = await seedUserWithSession('batch-stale');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'stale');
    const firstClientMutationId = randomUUID();

    const first = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies: owner.cookies,
      payload: envelope(owner.user.id, firstClientMutationId, 0, 'el-1', 1, 1),
    });
    expect(first.statusCode).toBe(200);

    // Second batch still claims baseRevision 0, unaware of the first op (now revision 1).
    const second = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies: owner.cookies,
      payload: envelope(owner.user.id, randomUUID(), 0, 'el-2', 1, 1),
    });

    expect(second.statusCode).toBe(200);
    const body = second.json();
    expect(body.currentRevision).toBe(2);
    expect(body.missingOperations).toHaveLength(1);
    expect(body.missingOperations[0]).toMatchObject({ clientMutationId: firstClientMutationId });

    const rows = await opRows(diagramId);
    expect(rows).toHaveLength(2);
  });

  it('two operations on the SAME element converge via versionNonce LWW while both survive in the op-log (REC-05)', async () => {
    const owner = await seedUserWithSession('batch-lww');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'lww');

    // Equal version, different versionNonce — the reconcile tie-break (T19) keeps
    // whichever side has the LOWER versionNonce, independent of arrival order.
    // A real (restoreElements-shaped) fixture is used here, not a minimal fake
    // object, because reconcileElements' fractional-index repair path mutates
    // elements missing a valid `index` field — which would scramble versionNonce
    // and mask the very tie-break this test is proving.
    const [fixtureBase] = allFixtures.text as readonly SceneElement[];
    if (!fixtureBase) throw new Error('fixture must have at least one element');
    const clientMutationIdA = randomUUID();
    const clientMutationIdB = randomUUID();
    const elementA = { ...fixtureBase, id: 'shared-el', version: 5, versionNonce: 200 };
    const elementB = { ...fixtureBase, id: 'shared-el', version: 5, versionNonce: 100 };
    const opA = {
      clientMutationId: clientMutationIdA,
      baseRevision: 0,
      actorId: owner.user.id,
      deltas: [
        {
          elementId: 'shared-el',
          kind: 'upsert' as const,
          element: elementA,
          version: 5,
          versionNonce: 200,
        },
      ],
    };
    const opB = {
      clientMutationId: clientMutationIdB,
      baseRevision: 0,
      actorId: owner.user.id,
      deltas: [
        {
          elementId: 'shared-el',
          kind: 'upsert' as const,
          element: elementB,
          version: 5,
          versionNonce: 100,
        },
      ],
    };

    const responseA = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies: owner.cookies,
      payload: opA,
    });
    const responseB = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies: owner.cookies,
      payload: opB,
    });

    expect(responseA.statusCode).toBe(200);
    expect(responseB.statusCode).toBe(200);

    // Both operations remain individually visible in the op-log — the losing
    // variant is never discarded from history (REC-05).
    const rows = await opRows(diagramId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.clientMutationId).sort()).toEqual(
      [clientMutationIdA, clientMutationIdB].sort(),
    );

    // The materialized scene (bootstrap's fold) reflects the LWW winner: versionNonce 100.
    const { scene } = await loadDiagramScene(db, diagramId);
    expect(scene).toHaveLength(1);
    expect(scene[0]).toMatchObject({ id: 'shared-el', versionNonce: 100 });
  });
});
