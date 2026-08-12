// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).
import { PGlite } from '@electric-sql/pglite';
import { and, asc, eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from './migrate.js';
import * as schema from './schema.js';
import { withTx } from './tx.js';

describe('diagram_operations + diagram_snapshots schema (T20, VER-01)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    // Applies cleanly on top of T5/T13's earlier migrations, no conflict.
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });
  });

  afterAll(async () => {
    await client.close();
  });

  async function seedDiagram(slugSuffix: string) {
    const [user] = await db
      .insert(schema.users)
      .values({ email: `ops-${slugSuffix}@example.com`, displayName: `Ops ${slugSuffix}` })
      .returning();
    if (!user) throw new Error('user insert failed');

    const [org] = await db
      .insert(schema.organizations)
      .values({ name: `Org ${slugSuffix}`, slug: `org-ops-${slugSuffix}` })
      .returning();
    if (!org) throw new Error('organization insert failed');

    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ organizationId: org.id, name: `WS ${slugSuffix}`, slug: `ws-ops-${slugSuffix}` })
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

  /** Mirrors the sequence-computing pattern the operations:batch route (T22) runs inside its own transaction. */
  async function insertOperation(diagramId: string, actorId: string, clientMutationId: string) {
    return withTx(db, async (tx) => {
      const existing = await tx
        .select({ sequence: schema.diagramOperations.sequence })
        .from(schema.diagramOperations)
        .where(eq(schema.diagramOperations.diagramId, diagramId))
        .orderBy(asc(schema.diagramOperations.sequence));
      const nextSequence = (existing.at(-1)?.sequence ?? 0) + 1;

      const [row] = await tx
        .insert(schema.diagramOperations)
        .values({
          diagramId,
          sequence: nextSequence,
          clientMutationId,
          actorId,
          baseRevision: nextSequence - 1,
          elementsDeltaJson: [],
          operationSummaryJson: { upserts: 0, deletes: 0, elementIds: [] },
        })
        .returning();
      return row;
    });
  }

  it('applies the migration cleanly and inserts one row per new table', async () => {
    const { user, diagram } = await seedDiagram('insert');

    const [operation] = await db
      .insert(schema.diagramOperations)
      .values({
        diagramId: diagram.id,
        sequence: 1,
        clientMutationId: '11111111-1111-4111-8111-111111111111',
        actorId: user.id,
        baseRevision: 0,
        elementsDeltaJson: [{ elementId: 'el-1', kind: 'upsert', version: 1, versionNonce: 1 }],
        operationSummaryJson: { upserts: 1, deletes: 0, elementIds: ['el-1'] },
      })
      .returning();
    expect(operation?.sequence).toBe(1);

    const [snapshot] = await db
      .insert(schema.diagramSnapshots)
      .values({
        diagramId: diagram.id,
        revision: 1,
        kind: 'auto',
        sceneJsonKey: `diagrams/${diagram.id}/snapshots/1.json`,
        checksum: 'sha256:deadbeef',
        createdBy: user.id,
      })
      .returning();
    expect(snapshot).toMatchObject({ kind: 'auto', immutable: false, revision: 1 });
  });

  it('rejects a second operation with the same (diagram_id, client_mutation_id) — idempotency invariant (EDT-04)', async () => {
    const { user, diagram } = await seedDiagram('idempotent');
    const clientMutationId = '22222222-2222-4222-8222-222222222222';

    await db.insert(schema.diagramOperations).values({
      diagramId: diagram.id,
      sequence: 1,
      clientMutationId,
      actorId: user.id,
      baseRevision: 0,
      elementsDeltaJson: [],
      operationSummaryJson: { upserts: 0, deletes: 0, elementIds: [] },
    });

    let caught: unknown;
    try {
      await db.insert(schema.diagramOperations).values({
        diagramId: diagram.id,
        sequence: 2,
        clientMutationId,
        actorId: user.id,
        baseRevision: 1,
        elementsDeltaJson: [],
        operationSummaryJson: { upserts: 0, deletes: 0, elementIds: [] },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const cause = (caught as { cause?: { code?: string } } | undefined)?.cause;
    expect(cause?.code).toBe('23505');

    const rows = await db
      .select()
      .from(schema.diagramOperations)
      .where(
        and(
          eq(schema.diagramOperations.diagramId, diagram.id),
          eq(schema.diagramOperations.clientMutationId, clientMutationId),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it('rejects a duplicate (diagram_id, sequence) pair even with distinct client_mutation_id', async () => {
    const { user, diagram } = await seedDiagram('dup-sequence');

    await db.insert(schema.diagramOperations).values({
      diagramId: diagram.id,
      sequence: 1,
      clientMutationId: '33333333-3333-4333-8333-333333333333',
      actorId: user.id,
      baseRevision: 0,
      elementsDeltaJson: [],
      operationSummaryJson: { upserts: 0, deletes: 0, elementIds: [] },
    });

    let caught: unknown;
    try {
      await db.insert(schema.diagramOperations).values({
        diagramId: diagram.id,
        sequence: 1,
        clientMutationId: '44444444-4444-4444-8444-444444444444',
        actorId: user.id,
        baseRevision: 0,
        elementsDeltaJson: [],
        operationSummaryJson: { upserts: 0, deletes: 0, elementIds: [] },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const cause = (caught as { cause?: { code?: string } } | undefined)?.cause;
    expect(cause?.code).toBe('23505');
  });

  it('generates a monotonically increasing sequence per diagram across multiple inserts', async () => {
    const { user, diagram } = await seedDiagram('monotonic');

    const first = await insertOperation(diagram.id, user.id, '55555555-5555-4555-8555-555555555555');
    const second = await insertOperation(diagram.id, user.id, '66666666-6666-4666-8666-666666666666');
    const third = await insertOperation(diagram.id, user.id, '77777777-7777-4777-8777-777777777777');

    expect([first?.sequence, second?.sequence, third?.sequence]).toEqual([1, 2, 3]);

    const rows = await db
      .select()
      .from(schema.diagramOperations)
      .where(eq(schema.diagramOperations.diagramId, diagram.id))
      .orderBy(asc(schema.diagramOperations.sequence));
    expect(rows.map((r) => r.sequence)).toEqual([1, 2, 3]);
  });

  it('keeps sequence numbering independent per diagram (two diagrams both start at 1)', async () => {
    const a = await seedDiagram('diagram-a');
    const b = await seedDiagram('diagram-b');

    const opA = await insertOperation(a.diagram.id, a.user.id, '88888888-8888-4888-8888-888888888888');
    const opB = await insertOperation(b.diagram.id, b.user.id, '99999999-9999-4999-8999-999999999999');

    expect(opA?.sequence).toBe(1);
    expect(opB?.sequence).toBe(1);
  });
});
