// SPEC_DEVIATION: PGlite instead of testcontainers — no Docker in this sandbox (AD-007).
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addOrganizationAdmin,
  LastOrgAdminError,
  listOrganizationAdmins,
  removeOrganizationAdmin,
  withLastOrgAdminGuard,
} from './organizationAdmins.js';

describe('organizationAdmins data layer (ORG-05..09)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });
  });

  afterAll(async () => {
    await client.close();
  });

  async function seedOrgWithUser(namePrefix: string) {
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: namePrefix, slug: `${namePrefix}-${Date.now()}-${Math.random()}` })
      .returning();
    const [user] = await db
      .insert(schema.users)
      .values({
        email: `${namePrefix}-${Date.now()}-${Math.random()}@example.com`,
        displayName: namePrefix,
      })
      .returning();
    if (!org || !user) throw new Error('seed failed');
    return { organizationId: org.id, userId: user.id };
  }

  it('addOrganizationAdmin -> listOrganizationAdmins -> removeOrganizationAdmin roundtrip', async () => {
    const { organizationId, userId } = await seedOrgWithUser('roundtrip-org');
    // A second admin so the removal below is legitimate — removing the ONLY admin is the
    // last-admin-guard case, covered by its own dedicated test.
    const { userId: keeperUserId } = await seedOrgWithUser('roundtrip-org-keeper');

    await addOrganizationAdmin(db, organizationId, userId);
    await addOrganizationAdmin(db, organizationId, keeperUserId);
    const admins = await listOrganizationAdmins(db, organizationId);
    expect(admins).toHaveLength(2);
    expect(admins.map((admin) => admin.userId)).toContain(userId);

    const removed = await removeOrganizationAdmin(db, organizationId, userId);
    expect(removed).toBe(true);
    const remaining = await listOrganizationAdmins(db, organizationId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.userId).toBe(keeperUserId);
  });

  it('addOrganizationAdmin is idempotent: granting an existing admin again neither errors nor duplicates the row (edge case)', async () => {
    const { organizationId, userId } = await seedOrgWithUser('idempotent-org');

    await addOrganizationAdmin(db, organizationId, userId);
    await addOrganizationAdmin(db, organizationId, userId);

    const admins = await listOrganizationAdmins(db, organizationId);
    expect(admins).toHaveLength(1);
  });

  it('withLastOrgAdminGuard refuses to remove the only administrator, throwing LastOrgAdminError, leaving the row in place', async () => {
    const { organizationId, userId } = await seedOrgWithUser('last-admin-org');
    await addOrganizationAdmin(db, organizationId, userId);

    await expect(removeOrganizationAdmin(db, organizationId, userId)).rejects.toThrow(
      LastOrgAdminError,
    );

    const admins = await listOrganizationAdmins(db, organizationId);
    expect(admins).toHaveLength(1);
    expect(admins[0]?.userId).toBe(userId);
  });

  it('allows removing one administrator while another remains', async () => {
    const { organizationId, userId } = await seedOrgWithUser('multi-admin-org');
    const { userId: secondUserId } = await seedOrgWithUser('multi-admin-org-second');
    await addOrganizationAdmin(db, organizationId, userId);
    await addOrganizationAdmin(db, organizationId, secondUserId);

    const removed = await removeOrganizationAdmin(db, organizationId, secondUserId);
    expect(removed).toBe(true);

    const admins = await listOrganizationAdmins(db, organizationId);
    expect(admins).toHaveLength(1);
    expect(admins[0]?.userId).toBe(userId);
  });

  it('withLastOrgAdminGuard is a no-op guard for a target who is not an administrator (change still runs)', async () => {
    const { organizationId, userId } = await seedOrgWithUser('non-admin-guard-org');
    // No addOrganizationAdmin call: userId never became an administrator.

    let changeRan = false;
    const result = await withLastOrgAdminGuard(db, organizationId, userId, async () => {
      changeRan = true;
      return 'ok';
    });

    expect(changeRan).toBe(true);
    expect(result).toBe('ok');
  });

  it('the lock covers the read and the write in the same transaction: two concurrent revocations of the last two admins leave at least one standing', async () => {
    const { organizationId, userId: first } = await seedOrgWithUser('concurrent-org');
    const { userId: second } = await seedOrgWithUser('concurrent-org-second');
    await addOrganizationAdmin(db, organizationId, first);
    await addOrganizationAdmin(db, organizationId, second);

    const results = await Promise.allSettled([
      removeOrganizationAdmin(db, organizationId, first),
      removeOrganizationAdmin(db, organizationId, second),
    ]);

    const admins = await listOrganizationAdmins(db, organizationId);
    // At least one of the two removals must have been refused or left a row behind — the
    // organization is never left with zero administrators (edge case, spec.md).
    expect(admins.length).toBeGreaterThanOrEqual(1);
    // Every settled result is either a successful boolean or a LastOrgAdminError — never an
    // unrelated crash.
    for (const outcome of results) {
      if (outcome.status === 'rejected') {
        expect(outcome.reason).toBeInstanceOf(LastOrgAdminError);
      }
    }
  });
});
