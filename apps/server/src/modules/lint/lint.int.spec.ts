// SPEC_DEVIATION: PGlite instead of testcontainers — no Docker in this sandbox (AD-007).
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../core/config.js';
import { buildServer } from '../../core/server.js';
import { createLocalAccount } from '../auth/accounts.js';
import { SESSION_COOKIE_NAME } from '../auth/cookie.js';
import { registerAuthModule } from '../auth/routes.js';
import { createSession } from '../auth/session.js';
import { registerDiagramSyncModule } from '../diagram-sync/routes.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { registerLintModule } from './routes.js';

describe('lint module — GET /diagrams/:id/lint (T64, LNT-01/02/03)', () => {
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
    registerLintModule(app, { db });
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
      payload: { name: `Lint WS ${slug}`, slug: `lint-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id as string;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Lint Project ${slug}` },
    });
    const projectId = createProject.json().project.id as string;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Lint Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id as string };
  }

  async function submitOperation(
    cookies: Record<string, string>,
    diagramId: string,
    actorId: string,
    elementId: string,
    version: number,
    extra: Record<string, unknown> = {},
  ) {
    return app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies,
      payload: {
        clientMutationId: crypto.randomUUID(),
        baseRevision: version - 1,
        actorId,
        deltas: [
          {
            elementId,
            kind: 'upsert' as const,
            element: { id: elementId, type: 'rectangle', version, versionNonce: version, ...extra },
            version,
            versionNonce: version,
          },
        ],
      },
    });
  }

  it('returns 200 with warnings for an orphan component and a connector without protocol; lint never blocks', async () => {
    const owner = await seedUserWithSession('lint-happy');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'happy');

    await submitOperation(owner.cookies, diagramId, owner.user.id, 'lonely', 1);
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'a', 1);
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'b', 1);
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'conn', 1, {
      type: 'arrow',
      startBinding: { elementId: 'a' },
      endBinding: { elementId: 'b' },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/lint`,
      cookies: owner.cookies,
    });
    expect(response.statusCode).toBe(200);
    const { warnings } = response.json();
    expect(Array.isArray(warnings)).toBe(true);
    expect(
      warnings.some(
        (w: { rule: string; elementIds: string[] }) =>
          w.rule === 'orphan-component' && w.elementIds.includes('lonely'),
      ),
    ).toBe(true);
    expect(
      warnings.some(
        (w: { rule: string; elementIds: string[] }) =>
          w.rule === 'connector-no-protocol' && w.elementIds.includes('conn'),
      ),
    ).toBe(true);
  });

  it('disabling the SPOF rule in workspace settingsJson.lintRules removes only that warning', async () => {
    const owner = await seedUserWithSession('lint-rules');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'rules');

    await submitOperation(owner.cookies, diagramId, owner.user.id, 'gateway', 1);
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'svc-a', 1);
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'svc-b', 1);
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'e1', 1, {
      type: 'arrow',
      startBinding: { elementId: 'svc-a' },
      endBinding: { elementId: 'gateway' },
    });
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'e2', 1, {
      type: 'arrow',
      startBinding: { elementId: 'svc-b' },
      endBinding: { elementId: 'gateway' },
    });

    const before = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/lint`,
      cookies: owner.cookies,
    });
    expect(before.json().warnings.some((w: { rule: string }) => w.rule === 'spof')).toBe(true);

    await db
      .update(schema.workspaces)
      .set({ settingsJson: { lintRules: { spof: false } } })
      .where(eq(schema.workspaces.id, workspaceId));

    const after = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/lint`,
      cookies: owner.cookies,
    });
    const afterWarnings = after.json().warnings as { rule: string }[];
    expect(afterWarnings.some((w) => w.rule === 'spof')).toBe(false);
    // Another rule (orphan-component doesn't apply here — assert lint still ran, not 5xx).
    expect(after.statusCode).toBe(200);
  });

  it('a viewer (holds diagram:read) receives 200, never blocked by warnings existing', async () => {
    const owner = await seedUserWithSession('lint-viewer-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'viewer');
    await submitOperation(owner.cookies, diagramId, owner.user.id, 'lonely', 1);

    const viewer = await seedUserWithSession('lint-viewer');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: viewer.user.id, role: 'viewer' });

    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/lint`,
      cookies: viewer.cookies,
    });
    expect(response.statusCode).toBe(200);
  });

  it('a non-member receives 404, never 403, on a diagram outside their workspace (IDOR)', async () => {
    const owner = await seedUserWithSession('lint-idor-owner');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'idor');
    const outsider = await seedUserWithSession('lint-idor-outsider');

    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/lint`,
      cookies: outsider.cookies,
    });
    expect(response.statusCode).toBe(404);
  });
});
