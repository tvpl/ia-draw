// SPEC_DEVIATION: PGlite instead of testcontainers — no Docker in this sandbox (AD-007).
import { randomUUID } from 'node:crypto';
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
import { registerPresentationModule } from '../presentation/routes.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { registerShareModule } from './routes.js';

describe('share module — capped-role, expiring share links (T78, EXT-01)', () => {
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
    registerPresentationModule(app, { db });
    registerShareModule(app, { db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await client.close();
  });

  async function seedUserWithSession(prefix: string) {
    const user = await createLocalAccount(db, {
      email: `${prefix}-${Date.now()}-${Math.random()}@example.com`,
      displayName: prefix,
      password: `${prefix}-password`,
    });
    const session = await createSession(db, user.id);
    return { user, cookies: { [SESSION_COOKIE_NAME]: session.token } };
  }

  async function seedDiagramAs(cookies: Record<string, string>, slug: string) {
    const createWs = await app.inject({
      method: 'POST',
      url: '/workspaces',
      cookies,
      payload: {
        name: `Share ${slug}`,
        slug: `share-${slug}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const workspaceId = createWs.json().workspace.id;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Share project ${slug}` },
    });
    const projectId = createProject.json().project.id;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Share diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id as string };
  }

  function futureIso(msFromNow = 60_000): string {
    return new Date(Date.now() + msFromNow).toISOString();
  }

  it('an editor creating a share link with role: workspace_admin is rejected (role ceiling)', async () => {
    const owner = await seedUserWithSession('ceiling-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'ceiling');
    const editor = await seedUserWithSession('ceiling-editor');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: editor.user.id, role: 'editor' });

    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/share-links`,
      cookies: editor.cookies,
      payload: { role: 'workspace_admin', expiresAt: futureIso() },
    });

    expect(response.statusCode).toBe(403);
    const rows = await db
      .select()
      .from(schema.shareLinks)
      .where(eq(schema.shareLinks.resourceId, diagramId));
    expect(rows).toHaveLength(0);
  });

  it('an editor CAN create a share link at or below their own role', async () => {
    const owner = await seedUserWithSession('within-ceiling-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'within-ceiling');
    const editor = await seedUserWithSession('within-ceiling-editor');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: editor.user.id, role: 'editor' });

    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/share-links`,
      cookies: editor.cookies,
      payload: { role: 'viewer', expiresAt: futureIso() },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().shareLink.role).toBe('viewer');
  });

  it('a reviewer/viewer (no diagram:mutate) cannot create a share link at all', async () => {
    const owner = await seedUserWithSession('no-mutate-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'no-mutate');
    const viewer = await seedUserWithSession('no-mutate-viewer');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: viewer.user.id, role: 'viewer' });

    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/share-links`,
      cookies: viewer.cookies,
      payload: { role: 'viewer', expiresAt: futureIso() },
    });

    expect(response.statusCode).toBe(403);
  });

  it('the token returned at creation is never recoverable again — only its hash persists', async () => {
    const owner = await seedUserWithSession('one-shot-owner');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'one-shot');

    const create = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/share-links`,
      cookies: owner.cookies,
      payload: { role: 'viewer', expiresAt: futureIso() },
    });
    expect(create.statusCode).toBe(201);
    const { token, shareLink } = create.json();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);

    const [row] = await db
      .select()
      .from(schema.shareLinks)
      .where(eq(schema.shareLinks.id, shareLink.id));
    expect(row?.tokenHash).toBeDefined();
    expect(row?.tokenHash).not.toBe(token);
    // Nothing in the persisted row is the plaintext token.
    expect(JSON.stringify(row)).not.toContain(token);

    // The create response itself never echoes tokenHash back.
    expect(shareLink.tokenHash).toBeUndefined();
    expect(shareLink.token).toBeUndefined();

    // Revoking (the only other route returning a shareLink object) also never reveals the token.
    const revoke = await app.inject({
      method: 'POST',
      url: `/share-links/${shareLink.id}:revoke`,
      cookies: owner.cookies,
    });
    expect(revoke.statusCode).toBe(200);
    expect(JSON.stringify(revoke.json())).not.toContain(token);
  });

  it('GET /share/:token with an expired, revoked, or nonexistent token all return 404 identically', async () => {
    const owner = await seedUserWithSession('404-owner');
    const { diagramId } = await seedDiagramAs(owner.cookies, '404');

    const expiredCreate = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/share-links`,
      cookies: owner.cookies,
      payload: { role: 'viewer', expiresAt: futureIso(2_000) },
    });
    const expiredToken = expiredCreate.json().token as string;
    const expiredId = expiredCreate.json().shareLink.id as string;
    // Force it into the past directly (avoid a real 2s sleep in the test suite).
    await db
      .update(schema.shareLinks)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.shareLinks.id, expiredId));

    const revokedCreate = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/share-links`,
      cookies: owner.cookies,
      payload: { role: 'viewer', expiresAt: futureIso() },
    });
    const revokedToken = revokedCreate.json().token as string;
    const revokedId = revokedCreate.json().shareLink.id as string;
    await app.inject({
      method: 'POST',
      url: `/share-links/${revokedId}:revoke`,
      cookies: owner.cookies,
    });

    const expiredResponse = await app.inject({ method: 'GET', url: `/share/${expiredToken}` });
    const revokedResponse = await app.inject({ method: 'GET', url: `/share/${revokedToken}` });
    const nonexistentResponse = await app.inject({
      method: 'GET',
      url: `/share/${randomUUID()}-not-a-real-token`,
    });

    expect(expiredResponse.statusCode).toBe(404);
    expect(revokedResponse.statusCode).toBe(404);
    expect(nonexistentResponse.statusCode).toBe(404);
  });

  it('GET /share/:token serves the resource capped to the link role, even for a token that leaked to a real workspace_admin', async () => {
    const owner = await seedUserWithSession('capped-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'capped');

    await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies: owner.cookies,
      payload: {
        clientMutationId: randomUUID(),
        baseRevision: 0,
        actorId: owner.user.id,
        deltas: [
          {
            elementId: 'el-share-1',
            kind: 'upsert',
            element: { id: 'el-share-1', type: 'rectangle', version: 1, versionNonce: 1 },
            version: 1,
            versionNonce: 1,
          },
        ],
      },
    });

    const create = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/share-links`,
      cookies: owner.cookies,
      payload: { role: 'viewer', expiresAt: futureIso() },
    });
    const token = create.json().token as string;

    // Simulate the token leaking to a real workspace_admin of the SAME workspace.
    const admin = await seedUserWithSession('capped-admin');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: admin.user.id, role: 'workspace_admin' });

    const response = await app.inject({ method: 'GET', url: `/share/${token}` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.resourceType).toBe('diagram');
    // The link's own role (viewer), never inherited from any real member's role.
    expect(body.role).toBe('viewer');
    expect(body.scene).toHaveLength(1);
    expect(body.scene[0].id).toBe('el-share-1');
  });

  it(':revoke makes the link immediately invalid for subsequent requests', async () => {
    const owner = await seedUserWithSession('revoke-owner');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'revoke');

    const create = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/share-links`,
      cookies: owner.cookies,
      payload: { role: 'viewer', expiresAt: futureIso() },
    });
    const token = create.json().token as string;
    const shareLinkId = create.json().shareLink.id as string;

    const beforeRevoke = await app.inject({ method: 'GET', url: `/share/${token}` });
    expect(beforeRevoke.statusCode).toBe(200);

    const revoke = await app.inject({
      method: 'POST',
      url: `/share-links/${shareLinkId}:revoke`,
      cookies: owner.cookies,
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().shareLink.revokedAt).not.toBeNull();

    const afterRevoke = await app.inject({ method: 'GET', url: `/share/${token}` });
    expect(afterRevoke.statusCode).toBe(404);
  });

  it(':revoke by a non-creator, non-admin member is forbidden', async () => {
    const owner = await seedUserWithSession('revoke-forbidden-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'revoke-forbidden');
    const otherEditor = await seedUserWithSession('revoke-forbidden-editor');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: otherEditor.user.id, role: 'editor' });

    const create = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/share-links`,
      cookies: owner.cookies,
      payload: { role: 'viewer', expiresAt: futureIso() },
    });
    const shareLinkId = create.json().shareLink.id as string;

    const revoke = await app.inject({
      method: 'POST',
      url: `/share-links/${shareLinkId}:revoke`,
      cookies: otherEditor.cookies,
    });
    expect(revoke.statusCode).toBe(403);
  });

  it('a share link for a presentation redacts frame notes unless the link role can edit', async () => {
    const owner = await seedUserWithSession('presentation-share-owner');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'presentation-share');

    const createPresentation = await app.inject({
      method: 'POST',
      url: '/presentations',
      cookies: owner.cookies,
      payload: { diagramId, name: 'Share test presentation' },
    });
    const presentationId = createPresentation.json().presentation.id as string;

    await app.inject({
      method: 'POST',
      url: `/presentations/${presentationId}/frames`,
      cookies: owner.cookies,
      payload: { position: 0, notes: 'secret speaker notes' },
    });

    const viewerLink = await app.inject({
      method: 'POST',
      url: `/presentations/${presentationId}/share-links`,
      cookies: owner.cookies,
      payload: { role: 'viewer', expiresAt: futureIso() },
    });
    expect(viewerLink.statusCode).toBe(201);
    const viewerToken = viewerLink.json().token as string;

    const editorLink = await app.inject({
      method: 'POST',
      url: `/presentations/${presentationId}/share-links`,
      cookies: owner.cookies,
      payload: { role: 'editor', expiresAt: futureIso() },
    });
    const editorToken = editorLink.json().token as string;

    const viewerRead = await app.inject({ method: 'GET', url: `/share/${viewerToken}` });
    expect(viewerRead.statusCode).toBe(200);
    expect(viewerRead.json().frames[0].notes).toBeNull();

    const editorRead = await app.inject({ method: 'GET', url: `/share/${editorToken}` });
    expect(editorRead.statusCode).toBe(200);
    expect(editorRead.json().frames[0].notes).toBe('secret speaker notes');
  });

  it('creating a share link for a diagram outside the actor workspace is 404 (IDOR)', async () => {
    const outsider = await seedUserWithSession('idor-outsider');
    const owner = await seedUserWithSession('idor-owner');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'idor');

    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/share-links`,
      cookies: outsider.cookies,
      payload: { role: 'viewer', expiresAt: futureIso() },
    });
    expect(response.statusCode).toBe(404);
  });
});
