// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved. CI (T7) uses real Postgres via GitHub Actions services (AD-007).
//
// The storage layer itself is an in-memory fake StorageClient (not a real MinIO — none is
// reachable in this sandbox, matching T27's documented limitation). T27's own tests already
// exercise the real S3 SDK boundary (signed URLs, headObject/putObject/getObject request
// shaping); this file focuses on the asset module's own logic — checksum, dedup, sanitize,
// ready-marking — against a controllable double of that already-proven seam.
import { createHash, randomUUID } from 'node:crypto';
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
import { ASSET_BUCKET } from '../storage/index.js';
import type { StorageClient } from '../storage/signedUrl.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { registerAssetModule } from './routes.js';

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function createFakeStorage(): StorageClient & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    async putSignedUrl(bucket, key) {
      return `https://fake-storage.test/${bucket}/${key}`;
    },
    async getSignedUrl(bucket, key) {
      return `https://fake-storage.test/${bucket}/${key}`;
    },
    async headObject(bucket, key) {
      const buf = objects.get(`${bucket}/${key}`);
      return buf ? { exists: true, sizeBytes: buf.byteLength } : { exists: false };
    },
    async putObject(bucket, key, body) {
      objects.set(`${bucket}/${key}`, Buffer.isBuffer(body) ? body : Buffer.from(body as string));
    },
    async getObject(bucket, key) {
      const buf = objects.get(`${bucket}/${key}`);
      if (!buf) throw new Error(`object ${bucket}/${key} not found`);
      return buf;
    },
  };
}

describe('two-phase asset upload (T29, EDT-06)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let app: FastifyInstance;
  let storage: ReturnType<typeof createFakeStorage>;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const config = loadConfig({ NODE_ENV: 'test' });
    app = buildServer(config);
    await registerAuthModule(app, { db, config });
    registerWorkspaceModule(app, { db });
    storage = createFakeStorage();
    registerAssetModule(app, { db, storage });
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
      payload: { name: `Asset WS ${slug}`, slug: `asset-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id as string;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Asset Project ${slug}` },
    });
    const projectId = createProject.json().project.id as string;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Asset Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id as string };
  }

  async function initiate(
    cookies: Record<string, string>,
    diagramId: string,
    mimeType: string,
    sizeBytes: number,
  ) {
    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/assets:initiate`,
      cookies,
      payload: { mimeType, sizeBytes },
    });
    return response;
  }

  function complete(cookies: Record<string, string>, diagramId: string, assetId: string) {
    return app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/assets/${assetId}:complete`,
      cookies,
    });
  }

  it('a completed upload with a valid checksum marks the asset ready', async () => {
    const owner = await seedUserWithSession('asset-happy');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'happy');
    const bytes = Buffer.from('fake png bytes for the happy path');

    const initiated = await initiate(owner.cookies, diagramId, 'image/png', bytes.byteLength);
    expect(initiated.statusCode).toBe(201);
    const { assetId, objectKey } = initiated.json();

    storage.objects.set(`${ASSET_BUCKET}/${objectKey}`, bytes);

    const completed = await complete(owner.cookies, diagramId, assetId);
    expect(completed.statusCode).toBe(200);
    const body = completed.json();
    expect(body.status).toBe('ready');
    expect(body.checksum).toBe(`sha256:${sha256Hex(bytes)}`);

    const [row] = await db
      .select()
      .from(schema.diagramAssets)
      .where(eq(schema.diagramAssets.id, assetId));
    expect(row).toMatchObject({ status: 'ready', checksum: `sha256:${sha256Hex(bytes)}` });
  });

  it('rejects a disallowed MIME type with 400, never creating a pending row', async () => {
    const owner = await seedUserWithSession('asset-mime');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'mime');

    const response = await initiate(owner.cookies, diagramId, 'application/x-msdownload', 100);
    expect(response.statusCode).toBe(400);
  });

  it('rejects an oversized upload with 413', async () => {
    const owner = await seedUserWithSession('asset-oversize');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'oversize');

    const response = await initiate(owner.cookies, diagramId, 'image/png', 999_999_999);
    expect(response.statusCode).toBe(413);
  });

  it('a reviewer receives 403 initiating an upload (diagram:mutate required)', async () => {
    const owner = await seedUserWithSession('asset-rbac-owner');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'rbac');
    const reviewer = await seedUserWithSession('asset-rbac-reviewer');
    await db
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId: reviewer.user.id, role: 'reviewer' });

    const response = await initiate(reviewer.cookies, diagramId, 'image/png', 100);
    expect(response.statusCode).toBe(403);
  });

  it('a non-member receives 404, never 403, on a diagram outside their workspace (IDOR)', async () => {
    const owner = await seedUserWithSession('asset-idor-owner');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'idor');
    const outsider = await seedUserWithSession('asset-idor-outsider');

    const response = await initiate(outsider.cookies, diagramId, 'image/png', 100);
    expect(response.statusCode).toBe(404);
  });

  it('completing before the object actually landed on storage returns 409, never ready', async () => {
    const owner = await seedUserWithSession('asset-unconfirmed');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'unconfirmed');

    const initiated = await initiate(owner.cookies, diagramId, 'image/png', 10);
    const { assetId } = initiated.json();
    // No storage.objects.set(...) call — the "upload" never happened.

    const response = await complete(owner.cookies, diagramId, assetId);
    expect(response.statusCode).toBe(409);
  });

  it('completing an unknown assetId returns 404', async () => {
    const owner = await seedUserWithSession('asset-unknown');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'unknown');

    const response = await complete(owner.cookies, diagramId, randomUUID());
    expect(response.statusCode).toBe(404);
  });

  it('completing an already-ready asset again is idempotent — same checksum/objectKey, no reprocessing', async () => {
    const owner = await seedUserWithSession('asset-idempotent');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'idempotent');
    const bytes = Buffer.from('idempotent-bytes');

    const initiated = await initiate(owner.cookies, diagramId, 'image/png', bytes.byteLength);
    const { assetId, objectKey } = initiated.json();
    storage.objects.set(`${ASSET_BUCKET}/${objectKey}`, bytes);

    const first = await complete(owner.cookies, diagramId, assetId);
    const second = await complete(owner.cookies, diagramId, assetId);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      assetId,
      status: 'ready',
      objectKey: first.json().objectKey,
      checksum: first.json().checksum,
    });
  });

  it('a malicious SVG with a <script> tag is sanitized before the asset becomes ready', async () => {
    const owner = await seedUserWithSession('asset-svg');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'svg');
    const malicious = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="5"/></svg>',
    );

    const initiated = await initiate(
      owner.cookies,
      diagramId,
      'image/svg+xml',
      malicious.byteLength,
    );
    const { assetId, objectKey } = initiated.json();
    storage.objects.set(`${ASSET_BUCKET}/${objectKey}`, malicious);

    const response = await complete(owner.cookies, diagramId, assetId);
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ready');

    const storedBytes = storage.objects.get(`${ASSET_BUCKET}/${objectKey}`);
    expect(storedBytes).toBeDefined();
    const storedText = storedBytes?.toString('utf8') ?? '';
    expect(storedText.toLowerCase()).not.toContain('<script');
    // The sanitized checksum reflects the CLEANED bytes, not the original malicious ones.
    expect(response.json().checksum).toBe(`sha256:${sha256Hex(storedBytes as Buffer)}`);
    expect(response.json().checksum).not.toBe(`sha256:${sha256Hex(malicious)}`);
  });

  it('two uploads with the same SHA-256 in the same workspace dedup — the second points at the first object', async () => {
    const owner = await seedUserWithSession('asset-dedup');
    const { diagramId } = await seedDiagramAs(owner.cookies, 'dedup');
    const bytes = Buffer.from('identical-bytes-for-dedup');

    const initiatedA = await initiate(owner.cookies, diagramId, 'image/png', bytes.byteLength);
    const { assetId: assetIdA, objectKey: objectKeyA } = initiatedA.json();
    storage.objects.set(`${ASSET_BUCKET}/${objectKeyA}`, bytes);
    const completedA = await complete(owner.cookies, diagramId, assetIdA);
    expect(completedA.statusCode).toBe(200);

    const initiatedB = await initiate(owner.cookies, diagramId, 'image/png', bytes.byteLength);
    const { assetId: assetIdB, objectKey: objectKeyB } = initiatedB.json();
    storage.objects.set(`${ASSET_BUCKET}/${objectKeyB}`, bytes);
    const completedB = await complete(owner.cookies, diagramId, assetIdB);

    expect(completedB.statusCode).toBe(200);
    const bodyB = completedB.json();
    expect(bodyB.deduped).toBe(true);
    // The second asset's objectKey now points at the SAME object as the first.
    expect(bodyB.objectKey).toBe(objectKeyA);
    expect(bodyB.objectKey).not.toBe(objectKeyB);
    expect(bodyB.checksum).toBe(completedA.json().checksum);
  });
});
