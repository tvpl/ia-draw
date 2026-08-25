// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI uses real Postgres via GitHub Actions services (AD-007).

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from './migrate.js';
import * as schema from './schema.js';

/**
 * A copy of `infra/migrations` with the `0013_backfill_organization_admins` entry (and only
 * that one) removed from `meta/_journal.json` — schema migrations up to 0012 applied, the data
 * migration under test held back so this suite can seed `workspace_members` first, exactly as
 * a real upgrade would encounter pre-existing data. `drizzle-orm/pglite/migrator` reads only
 * `meta/_journal.json` plus the referenced `.sql` files at apply time (no snapshot needed), so
 * copying those two kinds of files is sufficient.
 */
async function buildPreBackfillMigrationsFolder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'arch-canvas-pre-backfill-migrations-'));
  await mkdir(join(dir, 'meta'));

  const journalRaw = await readFile(join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8');
  const journal = JSON.parse(journalRaw) as { entries: { tag: string }[] };
  const withoutBackfill = {
    ...journal,
    entries: journal.entries.filter((entry) => entry.tag !== '0013_backfill_organization_admins'),
  };
  await writeFile(join(dir, 'meta/_journal.json'), JSON.stringify(withoutBackfill));

  for (const entry of withoutBackfill.entries) {
    const sql = await readFile(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`));
    await writeFile(join(dir, `${entry.tag}.sql`), sql);
  }

  return dir;
}

/**
 * ORG-02: proves `0013_backfill_organization_admins.sql` preserves exactly the set of
 * `org_admin` users that existed in `workspace_members` before the migration — no one gains
 * or loses access from the migration itself, and a user holding `org_admin` in more than one
 * workspace of the same organization dedupes to a single `organization_members` row.
 */
describe('organization_members backfill migration (ORG-02, design.md "Schema")', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let preBackfillFolder: string;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    preBackfillFolder = await buildPreBackfillMigrationsFolder();
    // Applies 0000..0012 only — the schema exists, but 0013 (the backfill) has not run yet.
    await runMigrations(db, { migrationsFolder: preBackfillFolder });
  });

  afterAll(async () => {
    await client.close();
    await rm(preBackfillFolder, { recursive: true, force: true });
  });

  it('backfills exactly the pre-existing org_admin set, deduping a repeat user in the same organization', async () => {
    const [alice, bob, carol, dave] = await Promise.all([
      db
        .insert(schema.users)
        .values({ email: 'alice@example.com', displayName: 'Alice' })
        .returning(),
      db.insert(schema.users).values({ email: 'bob@example.com', displayName: 'Bob' }).returning(),
      db
        .insert(schema.users)
        .values({ email: 'carol@example.com', displayName: 'Carol' })
        .returning(),
      db
        .insert(schema.users)
        .values({ email: 'dave@example.com', displayName: 'Dave' })
        .returning(),
    ]);
    const aliceId = alice[0]?.id;
    const bobId = bob[0]?.id;
    const carolId = carol[0]?.id;
    const daveId = dave[0]?.id;
    if (!aliceId || !bobId || !carolId || !daveId) throw new Error('user seed failed');

    const [orgOne] = await db
      .insert(schema.organizations)
      .values({ name: 'Org One', slug: 'org-one' })
      .returning();
    const [orgTwo] = await db
      .insert(schema.organizations)
      .values({ name: 'Org Two', slug: 'org-two' })
      .returning();
    if (!orgOne || !orgTwo) throw new Error('organization seed failed');

    // Org One: 2 workspaces. Alice is org_admin in BOTH (same organization) — must dedupe to
    // one row. Bob is org_admin in only the first.
    const [orgOneWsA] = await db
      .insert(schema.workspaces)
      .values({ organizationId: orgOne.id, name: 'Org One WS A', slug: 'org-one-ws-a' })
      .returning();
    const [orgOneWsB] = await db
      .insert(schema.workspaces)
      .values({ organizationId: orgOne.id, name: 'Org One WS B', slug: 'org-one-ws-b' })
      .returning();
    if (!orgOneWsA || !orgOneWsB) throw new Error('workspace seed failed');

    // Org Two: 1 workspace. Carol is org_admin there.
    const [orgTwoWs] = await db
      .insert(schema.workspaces)
      .values({ organizationId: orgTwo.id, name: 'Org Two WS', slug: 'org-two-ws' })
      .returning();
    if (!orgTwoWs) throw new Error('workspace seed failed');

    await db.insert(schema.workspaceMembers).values([
      { workspaceId: orgOneWsA.id, userId: aliceId, role: 'org_admin' },
      { workspaceId: orgOneWsB.id, userId: aliceId, role: 'org_admin' },
      { workspaceId: orgOneWsA.id, userId: bobId, role: 'org_admin' },
      { workspaceId: orgTwoWs.id, userId: carolId, role: 'org_admin' },
      // Dave is only a workspace_admin — never org_admin anywhere — and must never appear.
      { workspaceId: orgOneWsA.id, userId: daveId, role: 'workspace_admin' },
    ]);

    // Now apply the real migration folder: 0000..0012 are already applied (matching hash), so
    // only 0013 (the backfill) runs, against the data just seeded.
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const rows = await db.select().from(schema.organizationMembers);
    const byOrgAndUser = new Set(rows.map((row) => `${row.organizationId}:${row.userId}`));

    expect(byOrgAndUser.size).toBe(3);
    expect(byOrgAndUser.has(`${orgOne.id}:${aliceId}`)).toBe(true);
    expect(byOrgAndUser.has(`${orgOne.id}:${bobId}`)).toBe(true);
    expect(byOrgAndUser.has(`${orgTwo.id}:${carolId}`)).toBe(true);
    // Dave (never org_admin) and Carol misattributed to Org One would both fail this bound.
    expect(byOrgAndUser.has(`${orgOne.id}:${daveId}`)).toBe(false);
    expect(byOrgAndUser.has(`${orgOne.id}:${carolId}`)).toBe(false);

    // Alice's two org_admin rows in Org One dedupe to exactly one organization_members row.
    const aliceRows = rows.filter((row) => row.userId === aliceId);
    expect(aliceRows).toHaveLength(1);
  });

  it('running the migration twice does not fail and does not duplicate rows (idempotent via ON CONFLICT DO NOTHING)', async () => {
    // Re-running the full migration set against the same already-migrated database must be a
    // no-op — this is what a second deploy of the same version does.
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const rows = await db.select().from(schema.organizationMembers);
    const byOrgAndUser = new Set(rows.map((row) => `${row.organizationId}:${row.userId}`));
    expect(byOrgAndUser.size).toBe(3);
  });
});
