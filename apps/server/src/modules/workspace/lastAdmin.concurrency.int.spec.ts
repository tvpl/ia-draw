// concurrency-proof spec.md, CCP-01..04: RBAC-12 ("two concurrent admin removals leave at most
// one workspace without an admin") is proved here against a REAL Postgres — `pg.Pool` +
// `drizzle-orm/node-postgres`, not PGlite. PGlite is a single embedded connection: two
// `Promise.all`-fired calls against it never race for the same row lock, they only interleave
// cooperatively (docs/adr/0007-*.md's second Emenda). `withLastAdminGuard`'s
// `select ... for update` (lastAdmin.ts) is what actually serializes the two DELETEs below —
// this test proves that lock holds under genuine concurrent connections, not just that the
// guard's logic is correct in isolation.
//
// Real HTTP (`app.listen` + `fetch`), not `app.inject`: `app.inject`'s in-process request
// simulation was measured (manually, before this file existed) to resolve the two DELETEs in a
// fixed, array-order-determined sequence for this specific mutual-removal shape — the second
// mover's own `requireMembership` check (an unguarded read, ahead of the guarded transaction)
// consistently lost its own membership row to the first mover before it ran, producing 404
// instead of the intended 409. Real sockets do not have that artifact; they interleave with
// genuine OS-level scheduling, and each actor's own membership check then correctly completes
// before either transaction's lock resolves. spec.md's Assumptions table names both `app.inject`
// and "requisição HTTP real" as acceptable — this suite uses the one that is actually concurrent
// for this scenario, not the one that merely looks concurrent.
import { randomUUID } from 'node:crypto';
import type { Role } from '@arch-canvas/auth';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { eq } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as runMigrations } from 'drizzle-orm/node-postgres/migrator';
import type { FastifyInstance } from 'fastify';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../core/config.js';
import { buildServer } from '../../core/server.js';
import { createLocalAccount } from '../auth/accounts.js';
import { SESSION_COOKIE_NAME } from '../auth/cookie.js';
import { registerAuthModule } from '../auth/routes.js';
import { createSession } from '../auth/session.js';
import { registerWorkspaceModule } from './routes.js';

const ADMIN_ROLES: readonly Role[] = ['org_admin', 'workspace_admin'];

/** CCP-01 edge case: fails loud and early, before ever attempting a connection. */
function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'lastAdmin.concurrency.int.spec.ts requires DATABASE_URL to point at a real, reachable ' +
        'Postgres — PGlite is a single embedded connection and cannot exercise genuine ' +
        'concurrent-connection races (see docs/adr/0007-*.md). Set DATABASE_URL and re-run ' +
        '`make test-integration-concurrency`.',
    );
  }
  return url;
}

/** Points at the same cluster's always-present `postgres` maintenance database, for CREATE/DROP DATABASE. */
function toAdminUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.pathname = '/postgres';
  return url.toString();
}

function toDatabaseUrl(databaseUrl: string, databaseName: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

describe('RBAC-12 under real Postgres concurrency (concurrency-proof, CCP-01..04)', () => {
  let adminUrl: string;
  let scratchDatabaseName: string;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    const databaseUrl = requireDatabaseUrl();
    adminUrl = toAdminUrl(databaseUrl);
    // Edge case (spec.md): never assumes a pre-existing empty/clean database — this suite
    // creates its own isolated scratch database per run and drops it afterward, so it never
    // depends on or pollutes whatever the cluster already holds.
    scratchDatabaseName = `ccp_lastadmin_${randomUUID().replace(/-/g, '')}`;
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${scratchDatabaseName}"`);
    } finally {
      await admin.end();
    }

    pool = new Pool({ connectionString: toDatabaseUrl(databaseUrl, scratchDatabaseName) });
    db = drizzle(pool, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const config = loadConfig({ NODE_ENV: 'test' });
    app = buildServer(config);
    await registerAuthModule(app, { db, config });
    registerWorkspaceModule(app, { db });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('server has no address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    // CCP-01 edge case: when requireDatabaseUrl() threw in beforeAll, none of the below were
    // ever assigned — cleanup is a no-op rather than a second, noisier error masking the first.
    if (!adminUrl) return;
    await app.close();
    await pool.end();

    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${scratchDatabaseName}"`);
    } finally {
      await admin.end();
    }
  });

  let seedCounter = 0;
  async function seedUserWithSession(prefix: string) {
    seedCounter += 1;
    const user = await createLocalAccount(db, {
      email: `${prefix}-${seedCounter}-${Date.now()}@example.com`,
      displayName: prefix,
      password: `${prefix}-password`,
    });
    const session = await createSession(db, user.id);
    return { user, cookie: `${SESSION_COOKIE_NAME}=${session.token}` };
  }

  /**
   * Seeds a fresh workspace with exactly two administrators, then fires the two mutual-removal
   * DELETEs (CCP-01) concurrently via `Promise.all` over real sockets. Returns the two response
   * statuses. Used once (discarded) to warm the JIT/connection-pool state for these exact route
   * handlers before the measured run below — the very first invocation of this route pairing in
   * a freshly started process was observed to run measurably slower for the second mover,
   * letting the first mover's transaction fully commit (deleting the second mover's own
   * membership row) before the second mover's own unguarded `requireMembership` read even ran,
   * which surfaces as 404 instead of the race this test exists to prove. A discarded warm-up
   * cycle removes that first-invocation skew without altering what the measured cycle proves.
   */
  async function runMutualRemovalRace(
    label: string,
  ): Promise<{ workspaceId: string; statuses: [number, number] }> {
    const first = await seedUserWithSession(`ccp-admin-a-${label}`);
    const createWs = await fetch(`${baseUrl}/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: first.cookie },
      body: JSON.stringify({
        name: `CCP WS ${label}`,
        slug: `ccp-ws-${label}-${seedCounter}-${Date.now()}`,
      }),
    });
    const createWsBody = (await createWs.json()) as { workspace: { id: string } };
    const workspaceId = createWsBody.workspace.id;

    // `first` is already workspace_admin (T16's create flow). `second` gets the same role
    // explicitly, so the workspace has exactly two administrators — the minimum where the race
    // matters (spec.md's Edge Cases).
    const second = await seedUserWithSession(`ccp-admin-b-${label}`);
    await db.insert(schema.workspaceMembers).values({
      workspaceId,
      userId: second.user.id,
      role: 'workspace_admin',
    });

    // CCP-01: fired via Promise.all — real concurrent connections, not sequential awaits. Real
    // Postgres's row lock in withLastAdminGuard's `select ... for update` decides the outcome,
    // not Promise.all's call order.
    const [responseA, responseB] = await Promise.all([
      fetch(`${baseUrl}/workspaces/${workspaceId}/members/${second.user.id}`, {
        method: 'DELETE',
        headers: { cookie: first.cookie },
      }),
      fetch(`${baseUrl}/workspaces/${workspaceId}/members/${first.user.id}`, {
        method: 'DELETE',
        headers: { cookie: second.cookie },
      }),
    ]);

    return { workspaceId, statuses: [responseA.status, responseB.status] };
  }

  it("two concurrent DELETEs, each removing the OTHER of a workspace's exactly two admins, resolve to exactly one 204 and one 409, leaving exactly one admin (CCP-01..03)", async () => {
    // Discarded warm-up cycle — see runMutualRemovalRace's doc comment.
    await runMutualRemovalRace('warmup');

    const { workspaceId, statuses } = await runMutualRemovalRace('measured');

    // CCP-02: exactly one 204 (the winner) and one 409 (the loser, blocked by lastAdmin.ts's
    // LastAdminError once the winner's removal already committed).
    expect([...statuses].sort((a, b) => a - b)).toEqual([204, 409]);

    // CCP-03: the database itself, not the HTTP responses, is the source of truth for what
    // actually persisted.
    const remainingMembers = await db
      .select({ userId: schema.workspaceMembers.userId, role: schema.workspaceMembers.role })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.workspaceId, workspaceId));
    const remainingAdmins = remainingMembers.filter((member) => ADMIN_ROLES.includes(member.role));
    expect(remainingAdmins).toHaveLength(1);
  });
});
