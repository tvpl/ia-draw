// SPEC_DEVIATION: PGlite instead of testcontainers — no Docker in this sandbox (AD-007).

import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import type { SceneElement } from '@arch-canvas/editor-adapter';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expandComponentRelations, findElementsByComponentKey } from './componentLookup.js';

function rect(id: string): SceneElement {
  return { id, type: 'rectangle', isDeleted: false } as unknown as SceneElement;
}

function arrow(id: string, from: string, to: string): SceneElement {
  return {
    id,
    type: 'arrow',
    isDeleted: false,
    startBinding: { elementId: from },
    endBinding: { elementId: to },
  } as unknown as SceneElement;
}

function boundText(id: string, containerId: string, text: string): SceneElement {
  return { id, type: 'text', isDeleted: false, containerId, text } as unknown as SceneElement;
}

describe('expandComponentRelations (MCP-03, pure)', () => {
  it('returns correct inbound/outbound edges (with resolved labels) for the resolved element', () => {
    const scene = [
      rect('n1'),
      rect('n2'),
      arrow('a1', 'n1', 'n2'),
      boundText('t1', 'a1', 'reads from'),
    ];

    const n1Relations = expandComponentRelations(scene, 'n1');
    expect(n1Relations.outbound).toEqual([{ from: 'n1', to: 'n2', label: 'reads from' }]);
    expect(n1Relations.inbound).toEqual([]);

    // Edge direction correct inbound vs outbound: the same arrow is inbound for n2.
    const n2Relations = expandComponentRelations(scene, 'n2');
    expect(n2Relations.inbound).toEqual([{ from: 'n1', to: 'n2', label: 'reads from' }]);
    expect(n2Relations.outbound).toEqual([]);
  });

  it('an element with no connecting arrows returns empty inbound/outbound, not an error', () => {
    const scene = [rect('n1'), rect('n2'), arrow('a1', 'n1', 'n2')];

    const relations = expandComponentRelations(scene, 'n3');
    expect(relations).toEqual({ inbound: [], outbound: [] });
  });
});

describe('findElementsByComponentKey (MCP-03, DB-backed)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let diagramId: string;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const [org] = await db
      .insert(schema.organizations)
      .values({ name: 'Org', slug: `org-complk-${Date.now()}` })
      .returning();
    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ organizationId: org?.id ?? '', name: 'WS', slug: `ws-complk-${Date.now()}` })
      .returning();
    const [user] = await db
      .insert(schema.users)
      .values({ email: `complk-${Date.now()}@example.com`, displayName: 'Lookup tester' })
      .returning();
    const [project] = await db
      .insert(schema.projects)
      .values({ workspaceId: workspace?.id ?? '', name: 'Project', ownerId: user?.id ?? '' })
      .returning();
    const [diagram] = await db
      .insert(schema.diagrams)
      .values({ projectId: project?.id ?? '', title: 'Diagram', ownerId: user?.id ?? '' })
      .returning();
    diagramId = diagram?.id ?? '';

    await db.insert(schema.diagramElementsMeta).values([
      {
        diagramId,
        elementId: 'el-1',
        metadataJson: { componentKey: 'generic.compute.server' },
        revision: 0,
      },
      {
        diagramId,
        elementId: 'el-2',
        metadataJson: { componentKey: 'generic.compute.server' },
        revision: 0,
      },
      {
        diagramId,
        elementId: 'el-3',
        metadataJson: { componentKey: 'aws.rds' },
        revision: 0,
      },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it('resolves every element whose metadataJson.componentKey matches the stableKey', async () => {
    const matches = await findElementsByComponentKey(db, diagramId, 'aws.rds');
    expect(matches.map((row) => row.elementId)).toEqual(['el-3']);
  });

  it('a stableKey with no matching element resolves to an empty array', async () => {
    const matches = await findElementsByComponentKey(db, diagramId, 'does.not.exist');
    expect(matches).toEqual([]);
  });

  it('multiple elements sharing the same componentKey in the same diagram all resolve', async () => {
    const matches = await findElementsByComponentKey(db, diagramId, 'generic.compute.server');
    expect(new Set(matches.map((row) => row.elementId))).toEqual(new Set(['el-1', 'el-2']));
  });
});
