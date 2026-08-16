// SPEC_DEVIATION: PGlite instead of testcontainers — no Docker in this sandbox (AD-007).
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createMcpToken,
  findMcpTokenByHash,
  isMcpTokenActive,
  revokeMcpToken,
} from './mcpTokens.js';

describe('mcpTokens data access (MCP-04)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Org', slug: `org-${Date.now()}` })
      .returning();
    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ organizationId: org?.id ?? '', name: 'WS', slug: `ws-${Date.now()}` })
      .returning();
    const [user] = await db
      .insert(schema.users)
      .values({ email: `mcp-token-${Date.now()}@example.com`, displayName: 'MCP tester' })
      .returning();
    workspaceId = workspace?.id ?? '';
    userId = user?.id ?? '';
  });

  afterAll(async () => {
    await client.close();
  });

  it('create -> findByHash -> revoke -> findByHash roundtrip: revocation is visible immediately', async () => {
    const created = await createMcpToken(db, {
      workspaceId,
      role: 'editor',
      label: 'CI agent',
      createdBy: userId,
      tokenHash: 'hash-roundtrip',
    });
    expect(created.workspaceId).toBe(workspaceId);
    expect(created.role).toBe('editor');
    expect(created.revokedAt).toBeNull();

    const found = await findMcpTokenByHash(db, 'hash-roundtrip');
    expect(found?.id).toBe(created.id);
    expect(isMcpTokenActive(found as NonNullable<typeof found>)).toBe(true);

    const revoked = await revokeMcpToken(db, created.id);
    expect(revoked?.revokedAt).not.toBeNull();

    const foundAfterRevoke = await findMcpTokenByHash(db, 'hash-roundtrip');
    expect(foundAfterRevoke?.revokedAt).not.toBeNull();
    expect(isMcpTokenActive(foundAfterRevoke as NonNullable<typeof foundAfterRevoke>)).toBe(false);

    // Revoking again is idempotent, not an error, and still resolves the same row.
    const revokedAgain = await revokeMcpToken(db, created.id);
    expect(revokedAgain?.id).toBe(created.id);

    // A hash that was never issued resolves to null, distinctly from a revoked-but-real one.
    expect(await findMcpTokenByHash(db, 'does-not-exist')).toBeNull();
  });
});
