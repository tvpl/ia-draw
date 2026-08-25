// Run only via vite-node (see vite-node.config.ts's doc comment for why) — Playwright's
// webServer config (playwright.config.ts) spawns this as
// `pnpm exec vite-node --config e2e/support/vite-node.config.ts e2e/support/runTestServer.ts`.
//
// Boots a real apps/server instance (PGlite-backed, AD-007) — the exact same
// buildServer + register*Module pattern every apps/server integration test already
// uses (T14-T23) — and seeds one deterministic user/workspace/project/diagram
// (fixedSeed.ts) so the Playwright test file needs no cross-process handshake beyond
// those constants.
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { buildServer, loadConfig } from '@arch-canvas/server/dist/core/index.js';
import { createLocalAccount } from '@arch-canvas/server/dist/modules/auth/index.js';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import { installDomShim } from './domShim.js';
import { createFakeStorage } from './fakeStorage.js';
import {
  E2E_DIAGRAM_ID,
  E2E_ORG_ID,
  E2E_PROJECT_ID,
  E2E_USER_EMAIL,
  E2E_USER_PASSWORD,
  E2E_WORKSPACE_ID,
  TEST_SERVER_PORT,
} from './fixedSeed.js';

// diagram-sync transitively imports @excalidraw/excalidraw (via diagram-domain ->
// editor-adapter, for server-side LWW reconciliation) — the shim is installed before
// that import runs, never before it, since the shim itself doesn't need to exist for
// database/pglite above.
//
// ESTB-12: this registers the SAME module set the real server registers, rather than a
// hand-picked subset. The editor route calls comments, lint and docgen on mount and opens
// a presence socket; a subset makes those 404, and a 404 the real server never returns is
// exactly the kind of harness-only noise that would force an allowlist entry into
// editor-console.spec.ts.
installDomShim();
const { registerAllModules } = await import('@arch-canvas/server/dist/core/index.js');

async function main(): Promise<void> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

  await db
    .insert(schema.organizations)
    .values({ id: E2E_ORG_ID, name: 'E2E Org', slug: 'e2e-org' });
  const user = await createLocalAccount(db, {
    email: E2E_USER_EMAIL,
    displayName: 'E2E User',
    password: E2E_USER_PASSWORD,
  });
  await db.insert(schema.workspaces).values({
    id: E2E_WORKSPACE_ID,
    organizationId: E2E_ORG_ID,
    name: 'E2E Workspace',
    slug: 'e2e-ws',
  });
  await db.insert(schema.workspaceMembers).values({
    workspaceId: E2E_WORKSPACE_ID,
    userId: user.id,
    role: 'workspace_admin',
  });
  await db.insert(schema.projects).values({
    id: E2E_PROJECT_ID,
    workspaceId: E2E_WORKSPACE_ID,
    name: 'E2E Project',
    ownerId: user.id,
  });
  await db.insert(schema.diagrams).values({
    id: E2E_DIAGRAM_ID,
    projectId: E2E_PROJECT_ID,
    title: 'E2E Diagram',
    ownerId: user.id,
  });

  const config = loadConfig({ NODE_ENV: 'test', PORT: String(TEST_SERVER_PORT) });
  const app = buildServer(config);
  // No `jobs` dependency: pg-boss needs a real Postgres connection string and nothing on
  // the editor route depends on a job having run. `storage` is faked (SRF-04): the real
  // client points at http://localhost:9000 by default and nothing here provisions MinIO,
  // so any storage-touching route (snapshots, exports, assets, presentation publish) failed
  // with ECONNREFUSED before this — the first e2e spec to touch presentation-publish is what
  // surfaced it. Everything else is wired as in production.
  await registerAllModules(app, db, config, { storage: createFakeStorage() });
  await app.ready();
  await app.listen({ port: TEST_SERVER_PORT, host: '127.0.0.1' });

  console.log(`[e2e-test-server] ready on http://127.0.0.1:${TEST_SERVER_PORT}`);
}

await main();
