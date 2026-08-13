// SPEC_DEVIATION: PGlite instead of testcontainers — no Docker in this sandbox (AD-007).
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
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
import { registerWorkspaceModule } from '../workspace/index.js';
import { registerPresentationModule } from './routes.js';

describe('presentation module — CRUD, frame ordering, nav links (T65, PRS-01/03)', () => {
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
    registerPresentationModule(app, { db });
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
      payload: { name: `Pres WS ${slug}`, slug: `pres-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id as string;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Pres Project ${slug}` },
    });
    const projectId = createProject.json().project.id as string;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Pres Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id as string };
  }

  async function createPresentationWithFrames(cookies: Record<string, string>, diagramId: string) {
    const create = await app.inject({
      method: 'POST',
      url: '/presentations',
      cookies,
      payload: { diagramId, name: 'Walkthrough' },
    });
    const presentationId = create.json().presentation.id as string;

    const frameIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/presentations/${presentationId}/frames`,
        cookies,
        payload: { frameId: `logical-frame-${i}`, position: i, notes: `private note ${i}` },
      });
      frameIds.push(res.json().frame.id as string);
    }
    return { presentationId, frameIds };
  }

  it('creates a presentation with 4 frames, reorders via bulk PATCH, and GET reflects the new order', async () => {
    const owner = await seedUserWithSession('pres-order');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'order');
    const { presentationId, frameIds } = await createPresentationWithFrames(
      owner.cookies,
      diagramId,
    );

    // Reverse the order.
    const reversed = frameIds.map((id, i) => ({ id, position: frameIds.length - 1 - i }));
    const reorder = await app.inject({
      method: 'PATCH',
      url: `/presentations/${presentationId}/frames`,
      cookies: owner.cookies,
      payload: { frames: reversed },
    });
    expect(reorder.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET',
      url: `/presentations/${presentationId}`,
      cookies: owner.cookies,
    });
    expect(get.statusCode).toBe(200);
    const { frames } = get.json();
    expect(frames.map((f: { id: string }) => f.id)).toEqual([...frameIds].reverse());
  });

  it('a navLinksJson pointing at another frame in the same presentation persists and is returned intact', async () => {
    const owner = await seedUserWithSession('pres-navlink');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'navlink');
    const { presentationId, frameIds } = await createPresentationWithFrames(
      owner.cookies,
      diagramId,
    );

    const targetFrameId = frameIds[1] as string;
    const update = await app.inject({
      method: 'PATCH',
      url: `/presentations/${presentationId}/frames/${frameIds[0]}`,
      cookies: owner.cookies,
      payload: { navLinksJson: [{ targetFrameId }] },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().frame.navLinksJson).toEqual([{ targetFrameId }]);

    const get = await app.inject({
      method: 'GET',
      url: `/presentations/${presentationId}`,
      cookies: owner.cookies,
    });
    const frame0 = get.json().frames.find((f: { id: string }) => f.id === frameIds[0]);
    expect(frame0.navLinksJson).toEqual([{ targetFrameId }]);
  });

  it('a navLinksJson pointing at a nonexistent targetFrameId returns 400', async () => {
    const owner = await seedUserWithSession('pres-badlink');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'badlink');
    const { presentationId, frameIds } = await createPresentationWithFrames(
      owner.cookies,
      diagramId,
    );

    const update = await app.inject({
      method: 'PATCH',
      url: `/presentations/${presentationId}/frames/${frameIds[0]}`,
      cookies: owner.cookies,
      payload: { navLinksJson: [{ targetFrameId: 'does-not-exist' }] },
    });
    expect(update.statusCode).toBe(400);
  });

  it('a reviewer receives 403 creating/editing a presentation; GET still works', async () => {
    const owner = await seedUserWithSession('pres-rbac-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'rbac');
    const reviewer = await seedUserWithSession('pres-rbac-reviewer');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: reviewer.user.id, role: 'reviewer' });

    const createAsReviewer = await app.inject({
      method: 'POST',
      url: '/presentations',
      cookies: reviewer.cookies,
      payload: { diagramId, name: 'Reviewer Attempt' },
    });
    expect(createAsReviewer.statusCode).toBe(403);

    const { presentationId } = await createPresentationWithFrames(owner.cookies, diagramId);
    const editAsReviewer = await app.inject({
      method: 'PATCH',
      url: `/presentations/${presentationId}`,
      cookies: reviewer.cookies,
      payload: { name: 'Hijacked' },
    });
    expect(editAsReviewer.statusCode).toBe(403);

    const getAsReviewer = await app.inject({
      method: 'GET',
      url: `/presentations/${presentationId}`,
      cookies: reviewer.cookies,
    });
    expect(getAsReviewer.statusCode).toBe(200);
    // Reviewer (no diagram:mutate) never receives private frame notes.
    for (const frame of getAsReviewer.json().frames) {
      expect(frame.notes).toBeNull();
    }
  });

  it('the owner (holds diagram:mutate) DOES receive frame notes on GET', async () => {
    const owner = await seedUserWithSession('pres-notes-owner');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'notes');
    const { presentationId } = await createPresentationWithFrames(owner.cookies, diagramId);

    const get = await app.inject({
      method: 'GET',
      url: `/presentations/${presentationId}`,
      cookies: owner.cookies,
    });
    expect(get.json().frames.every((f: { notes: string | null }) => f.notes !== null)).toBe(true);
  });

  it('a non-member receives 404, never 403, on a presentation outside their workspace (IDOR)', async () => {
    const owner = await seedUserWithSession('pres-idor-owner');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'idor');
    const { presentationId } = await createPresentationWithFrames(owner.cookies, diagramId);
    const outsider = await seedUserWithSession('pres-idor-outsider');

    const response = await app.inject({
      method: 'GET',
      url: `/presentations/${presentationId}`,
      cookies: outsider.cookies,
    });
    expect(response.statusCode).toBe(404);
  });
});
