// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from './migrate.js';
import * as schema from './schema.js';

describe('ai_provider_configs + ai_runs/ai_tool_calls schema (T40, AIC-01)', () => {
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

  async function seedUserAndDiagram(slugSuffix: string) {
    const [user] = await db
      .insert(schema.users)
      .values({ email: `ai-${slugSuffix}@example.com`, displayName: `User ${slugSuffix}` })
      .returning();
    if (!user) throw new Error('user insert failed');

    const [org] = await db
      .insert(schema.organizations)
      .values({ name: `Org ${slugSuffix}`, slug: `org-ai-${slugSuffix}` })
      .returning();
    if (!org) throw new Error('organization insert failed');

    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ organizationId: org.id, name: `WS ${slugSuffix}`, slug: `ws-ai-${slugSuffix}` })
      .returning();
    if (!workspace) throw new Error('workspace insert failed');

    const [project] = await db
      .insert(schema.projects)
      .values({ workspaceId: workspace.id, name: `Project ${slugSuffix}`, ownerId: user.id })
      .returning();
    if (!project) throw new Error('project insert failed');

    const [diagram] = await db
      .insert(schema.diagrams)
      .values({ projectId: project.id, title: `Diagram ${slugSuffix}`, ownerId: user.id })
      .returning();
    if (!diagram) throw new Error('diagram insert failed');

    return { user, diagram };
  }

  it('applies the migration cleanly on top of the earlier migrations', async () => {
    const tables = await db.execute<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const names = tables.rows.map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining(['ai_provider_configs', 'ai_runs', 'ai_tool_calls']),
    );
  });

  it('ai_provider_configs has no plaintext token/secret column — only encrypted_token', async () => {
    const columns = await db.execute<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'ai_provider_configs'`,
    );
    const names = columns.rows.map((r) => r.column_name);
    expect(names).toContain('encrypted_token');
    // Every column name containing "token" or "secret" must be exactly "encrypted_token" —
    // no bare "token"/"secret" column exists anywhere on this table.
    const suspicious = names.filter(
      (name) => (name.includes('token') || name.includes('secret')) && name !== 'encrypted_token',
    );
    expect(suspicious).toEqual([]);
  });

  it('inserts one ai_provider_configs row and reads it back with the ciphertext intact', async () => {
    const [config] = await db
      .insert(schema.aiProviderConfigs)
      .values({
        scope: 'global',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        encryptedToken: 'v1:deadbeef:cafebabe',
        capabilitiesJson: { toolCalling: true },
      })
      .returning();
    expect(config).toMatchObject({
      scope: 'global',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      encryptedToken: 'v1:deadbeef:cafebabe',
      enabled: true,
    });
  });

  it('inserts an ai_runs row linked to a provider config, diagram and user, defaulting to status=queued', async () => {
    const { user, diagram } = await seedUserAndDiagram('runs');
    const [config] = await db
      .insert(schema.aiProviderConfigs)
      .values({
        scope: 'global',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        encryptedToken: 'v1:x:y',
      })
      .returning();
    if (!config) throw new Error('config insert failed');

    const [run] = await db
      .insert(schema.aiRuns)
      .values({
        diagramId: diagram.id,
        userId: user.id,
        providerConfigId: config.id,
        sourceRevision: 0,
        promptRedacted: '[redacted]',
      })
      .returning();
    expect(run).toMatchObject({
      diagramId: diagram.id,
      userId: user.id,
      providerConfigId: config.id,
      sourceRevision: 0,
      status: 'queued',
    });
  });

  it('inserts ai_tool_calls rows ordered by sequence within a run', async () => {
    const { user, diagram } = await seedUserAndDiagram('tool-calls');
    const [config] = await db
      .insert(schema.aiProviderConfigs)
      .values({
        scope: diagram.projectId, // any non-"global" string is a valid workspace-scoped value
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        encryptedToken: 'v1:x:y',
      })
      .returning();
    if (!config) throw new Error('config insert failed');
    const [run] = await db
      .insert(schema.aiRuns)
      .values({
        diagramId: diagram.id,
        userId: user.id,
        providerConfigId: config.id,
        sourceRevision: 0,
      })
      .returning();
    if (!run) throw new Error('run insert failed');

    await db.insert(schema.aiToolCalls).values([
      {
        aiRunId: run.id,
        toolName: 'search_library',
        argumentsRedacted: { query: '[redacted]' },
        sequence: 1,
      },
      {
        aiRunId: run.id,
        toolName: 'create_element',
        argumentsRedacted: { elementId: '[redacted]' },
        sequence: 2,
        approved: true,
      },
    ]);

    const rows = await db
      .select()
      .from(schema.aiToolCalls)
      .where(eq(schema.aiToolCalls.aiRunId, run.id));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.sequence).sort()).toEqual([1, 2]);
    expect(rows.find((r) => r.sequence === 2)?.approved).toBe(true);
  });

  it('rejects an ai_runs insert referencing a non-existent provider_config_id (FK enforced)', async () => {
    const { user, diagram } = await seedUserAndDiagram('fk-violation');
    const missingConfigId = '00000000-0000-0000-0000-000000000000';

    await expect(
      db.insert(schema.aiRuns).values({
        diagramId: diagram.id,
        userId: user.id,
        providerConfigId: missingConfigId,
        sourceRevision: 0,
      }),
    ).rejects.toThrow();
  });
});
