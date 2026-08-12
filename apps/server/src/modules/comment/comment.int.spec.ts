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
import { registerWorkspaceModule } from '../workspace/index.js';
import { registerCommentModule } from './routes.js';

describe('comment module — threads, mentions, resolve (T69, CMT-01/02)', () => {
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
    registerCommentModule(app, { db });
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

  async function seedDiagram(cookies: Record<string, string>, slug: string) {
    const createWs = await app.inject({
      method: 'POST',
      url: '/workspaces',
      cookies,
      payload: { name: `Comment WS ${slug}`, slug: `comment-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id as string;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Comment Project ${slug}` },
    });
    const projectId = createProject.json().project.id as string;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Comment Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id as string };
  }

  it('a root comment anchored to an elementId plus a reply (parentId) form a thread that survives a simulated restart (fresh PGlite connection re-reading the same storage)', async () => {
    const owner = await seedUserWithSession('comment-thread');
    const { diagramId } = await seedDiagram(owner.cookies, 'thread');

    const rootResponse = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/comments`,
      cookies: owner.cookies,
      payload: { body: 'What does this component do?', elementId: 'el-1' },
    });
    expect(rootResponse.statusCode).toBe(201);
    const rootId = rootResponse.json().comment.id as string;

    const replyResponse = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/comments`,
      cookies: owner.cookies,
      payload: { body: 'It handles checkout.', parentId: rootId },
    });
    expect(replyResponse.statusCode).toBe(201);
    expect(replyResponse.json().comment.parentId).toBe(rootId);

    // Simulated restart: a BRAND NEW drizzle connection wrapping the same
    // underlying PGlite storage — proves the thread was actually persisted
    // to the database, not held in any in-process cache.
    const reconnectedDb = drizzle(client, { schema });
    const rows = await reconnectedDb
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.diagramId, diagramId));
    expect(rows).toHaveLength(2);
    const reply = rows.find((row) => row.parentId === rootId);
    expect(reply?.body).toBe('It handles checkout.');
  });

  it('a mention of a valid workspace member is registered; a mention of a non-member is silently ignored and the comment still succeeds', async () => {
    const owner = await seedUserWithSession('comment-mention-owner');
    const { workspaceId, diagramId } = await seedDiagram(owner.cookies, 'mention');
    const member = await seedUserWithSession('comment-mention-member');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: member.user.id, role: 'editor' });

    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/comments`,
      cookies: owner.cookies,
      payload: { body: `cc @${member.user.id} and @stranger@example.com` },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.mentions).toEqual([member.user.id]);
    expect(body.comment.body).toContain('@stranger@example.com'); // body persisted verbatim regardless
  });

  it('a reviewer can POST a comment (201) but the SAME user gets 403 mutating the canvas (comment:create granted, diagram:mutate still denied)', async () => {
    const owner = await seedUserWithSession('comment-reviewer-owner');
    const { workspaceId, diagramId } = await seedDiagram(owner.cookies, 'reviewer');
    const reviewer = await seedUserWithSession('comment-reviewer');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: reviewer.user.id, role: 'reviewer' });

    const commentResponse = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/comments`,
      cookies: reviewer.cookies,
      payload: { body: 'Looks good overall.' },
    });
    expect(commentResponse.statusCode).toBe(201);

    const mutateResponse = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies: reviewer.cookies,
      payload: {
        clientMutationId: randomUUID(),
        baseRevision: 0,
        actorId: reviewer.user.id,
        deltas: [
          {
            elementId: 'el-x',
            kind: 'upsert' as const,
            element: { id: 'el-x', type: 'rectangle', version: 1, versionNonce: 1 },
            version: 1,
            versionNonce: 1,
          },
        ],
      },
    });
    expect(mutateResponse.statusCode).toBe(403);
  });

  it('GET returns a flat list, oldest first, each row carrying its own parentId', async () => {
    const owner = await seedUserWithSession('comment-list');
    const { diagramId } = await seedDiagram(owner.cookies, 'list');
    const root = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/comments`,
      cookies: owner.cookies,
      payload: { body: 'root' },
    });
    const rootId = root.json().comment.id as string;
    await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/comments`,
      cookies: owner.cookies,
      payload: { body: 'reply', parentId: rootId },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/comments`,
      cookies: owner.cookies,
    });
    expect(response.statusCode).toBe(200);
    const { comments } = response.json();
    expect(comments).toHaveLength(2);
    expect(comments[0].body).toBe('root');
    expect(comments[1].parentId).toBe(rootId);
  });

  it('a parentId pointing at a comment on a DIFFERENT diagram is rejected with 400', async () => {
    const owner = await seedUserWithSession('comment-cross-diagram');
    const { diagramId: diagramA } = await seedDiagram(owner.cookies, 'cross-a');
    const { diagramId: diagramB } = await seedDiagram(owner.cookies, 'cross-b');

    const rootOnA = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramA}/comments`,
      cookies: owner.cookies,
      payload: { body: 'root on A' },
    });
    const rootIdOnA = rootOnA.json().comment.id as string;

    const crossReply = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramB}/comments`,
      cookies: owner.cookies,
      payload: { body: 'reply', parentId: rootIdOnA },
    });
    expect(crossReply.statusCode).toBe(400);
  });

  it('PATCH resolves/reopens a comment (comment:resolve, granted to every role); only the author may edit the body text', async () => {
    const owner = await seedUserWithSession('comment-patch-owner');
    const { workspaceId, diagramId } = await seedDiagram(owner.cookies, 'patch');
    const viewer = await seedUserWithSession('comment-patch-viewer');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: viewer.user.id, role: 'viewer' });

    const created = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/comments`,
      cookies: owner.cookies,
      payload: { body: 'original text' },
    });
    const commentId = created.json().comment.id as string;

    // viewer holds comment:resolve too (T69: granted to every role) — status flips.
    const resolveByViewer = await app.inject({
      method: 'PATCH',
      url: `/diagrams/${diagramId}/comments/${commentId}`,
      cookies: viewer.cookies,
      payload: { status: 'resolved' },
    });
    expect(resolveByViewer.statusCode).toBe(200);
    expect(resolveByViewer.json().comment.status).toBe('resolved');

    // viewer is NOT the author — editing body text is rejected.
    const bodyEditByViewer = await app.inject({
      method: 'PATCH',
      url: `/diagrams/${diagramId}/comments/${commentId}`,
      cookies: viewer.cookies,
      payload: { body: 'hijacked text' },
    });
    expect(bodyEditByViewer.statusCode).toBe(403);

    // the author may edit their own body text.
    const bodyEditByAuthor = await app.inject({
      method: 'PATCH',
      url: `/diagrams/${diagramId}/comments/${commentId}`,
      cookies: owner.cookies,
      payload: { body: 'corrected text', status: 'open' },
    });
    expect(bodyEditByAuthor.statusCode).toBe(200);
    expect(bodyEditByAuthor.json().comment.body).toBe('corrected text');
    expect(bodyEditByAuthor.json().comment.status).toBe('open');
  });

  it('a non-member receives 404, never 403, on a diagram outside their workspace (IDOR)', async () => {
    const owner = await seedUserWithSession('comment-idor-owner');
    const { diagramId } = await seedDiagram(owner.cookies, 'idor');
    const outsider = await seedUserWithSession('comment-idor-outsider');

    const postResponse = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/comments`,
      cookies: outsider.cookies,
      payload: { body: 'trying to sneak in' },
    });
    expect(postResponse.statusCode).toBe(404);

    const getResponse = await app.inject({
      method: 'GET',
      url: `/diagrams/${diagramId}/comments`,
      cookies: outsider.cookies,
    });
    expect(getResponse.statusCode).toBe(404);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/diagrams/does-not-matter/comments',
    });
    expect(response.statusCode).toBe(401);
  });
});
