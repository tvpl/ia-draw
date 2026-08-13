// SPEC_DEVIATION: PGlite instead of testcontainers — no Docker in this sandbox (AD-007).
import { encryptToken } from '@arch-canvas/ai-tools';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER, workspaceMembers, workspaces } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLocalAccount } from '../auth/accounts.js';
import {
  BACKOFF_SCHEDULE_MS,
  deliverWebhookDelivery,
  enqueueWebhookEvent,
  getWebhookDeliveryById,
  MAX_DELIVERY_ATTEMPTS,
  signWebhookPayload,
  WEBHOOK_SIGNATURE_HEADER,
} from './deliver.js';
import { createWebhookEndpoint } from './webhooks.js';

const TEST_ENCRYPTION_KEY = 'deliver-test-encryption-key';

describe('webhook delivery pipeline — signing, retry backoff, dead-letter (T80, EXT-02)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let userId: string;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const user = await createLocalAccount(db, {
      email: `deliver-${Date.now()}@example.com`,
      displayName: 'deliver-owner',
      password: 'deliver-owner-password',
    });
    userId = user.id;
  });

  afterAll(async () => {
    await client.close();
  });

  // Each test gets its own fresh workspace — `enqueueWebhookEvent` matches
  // EVERY enabled endpoint subscribed to an event type WORKSPACE-WIDE, so
  // sharing one workspace across tests would leak endpoints from an earlier
  // test into a later test's assertions (e.g. the "no delivery row at all"
  // test would otherwise see `diagram.created` endpoints seeded by earlier
  // tests too).
  async function seedWorkspace(slug: string): Promise<string> {
    const [org] = await db
      .insert(schema.organizations)
      .values({ name: `Deliver Org ${slug}`, slug: `deliver-org-${slug}-${Date.now()}` })
      .returning({ id: schema.organizations.id });
    if (!org) throw new Error('failed to insert organization fixture');

    const [workspace] = await db
      .insert(workspaces)
      .values({
        organizationId: org.id,
        name: `Deliver WS ${slug}`,
        slug: `deliver-ws-${slug}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      })
      .returning({ id: workspaces.id });
    if (!workspace) throw new Error('failed to insert workspace fixture');

    const workspaceId = workspace.id;
    await db.insert(workspaceMembers).values({ workspaceId, userId, role: 'workspace_admin' });
    return workspaceId;
  }

  async function seedEndpoint(workspaceId: string, url: string, events: string[], enabled = true) {
    const secret = 'plaintext-webhook-secret';
    const row = await createWebhookEndpoint(db, {
      workspaceId,
      url,
      events: events as never,
      enabled,
      createdBy: userId,
      secretEncrypted: encryptToken(secret, TEST_ENCRYPTION_KEY),
    });
    return { row, secret };
  }

  it('a successful delivery (200) marks status delivered, with a header signature verifiable against the correct secret', async () => {
    const workspaceId = await seedWorkspace('ok');
    const { row: endpoint, secret } = await seedEndpoint(workspaceId, 'https://example.com/ok', [
      'diagram.created',
    ]);
    const [deliveryId] = await enqueueWebhookEvent(db, undefined, workspaceId, 'diagram.created', {
      diagramId: 'd-ok',
    });
    expect(deliveryId).toBeDefined();

    let capturedHeaders: Record<string, string> | undefined;
    let capturedBody: string | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = init?.body as string;
      return new Response('ok', { status: 200 });
    }) as unknown as typeof fetch;

    await deliverWebhookDelivery(
      db,
      TEST_ENCRYPTION_KEY,
      deliveryId as string,
      undefined,
      fetchImpl,
    );

    const delivery = await getWebhookDeliveryById(db, deliveryId as string);
    expect(delivery?.status).toBe('delivered');
    expect(delivery?.attempts).toBe(1);
    expect(delivery?.nextRetryAt).toBeNull();
    expect(delivery?.lastError).toBeNull();

    expect(capturedHeaders?.[WEBHOOK_SIGNATURE_HEADER]).toBe(
      signWebhookPayload(secret, capturedBody as string),
    );
    void endpoint;
  });

  it('a failed delivery (500) increments attempts and schedules nextRetryAt with growing backoff, then dead-letters after exhausting attempts', async () => {
    const workspaceId = await seedWorkspace('fail');
    await seedEndpoint(workspaceId, 'https://example.com/fail', ['diagram.updated']);
    const [deliveryId] = await enqueueWebhookEvent(db, undefined, workspaceId, 'diagram.updated', {
      diagramId: 'd-fail',
    });
    expect(deliveryId).toBeDefined();

    const fetchImpl = vi.fn(
      async () => new Response('server error', { status: 500 }),
    ) as unknown as typeof fetch;

    const observedDelays: number[] = [];
    let previousNextRetryAt: number | null = null;

    for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
      const before = Date.now();
      await deliverWebhookDelivery(
        db,
        TEST_ENCRYPTION_KEY,
        deliveryId as string,
        undefined,
        fetchImpl,
      );
      const delivery = await getWebhookDeliveryById(db, deliveryId as string);
      if (!delivery) throw new Error('delivery row vanished mid-test');
      expect(delivery.attempts).toBe(attempt);

      if (attempt < MAX_DELIVERY_ATTEMPTS) {
        expect(delivery.status).toBe('failed');
        expect(delivery.nextRetryAt).not.toBeNull();
        const nextRetryAtMs = (delivery.nextRetryAt as Date).getTime();
        const expectedMinDelayMs = BACKOFF_SCHEDULE_MS[attempt - 1] ?? 0;
        expect(nextRetryAtMs).toBeGreaterThanOrEqual(before + expectedMinDelayMs);
        observedDelays.push(nextRetryAtMs - before);
        previousNextRetryAt = nextRetryAtMs;
      } else {
        expect(delivery.status).toBe('dead_letter');
        expect(delivery.nextRetryAt).toBeNull();
        expect(delivery.lastError).toContain('500');
      }
    }

    // Backoff strictly increases across the 4 scheduled retries (1min/5min/30min/2h).
    for (let i = 1; i < observedDelays.length; i++) {
      const previous = observedDelays[i - 1] ?? 0;
      expect(observedDelays[i]).toBeGreaterThan(previous);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_DELIVERY_ATTEMPTS);
    void previousNextRetryAt;
  });

  it('a network error (fetch throws) is treated as a failure the same way a non-2xx response is', async () => {
    const workspaceId = await seedWorkspace('network-error');
    await seedEndpoint(workspaceId, 'https://example.com/network-error', ['diagram.created']);
    const [deliveryId] = await enqueueWebhookEvent(db, undefined, workspaceId, 'diagram.created', {
      diagramId: 'd-network',
    });

    const fetchImpl = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND example.com');
    }) as unknown as typeof fetch;

    await deliverWebhookDelivery(
      db,
      TEST_ENCRYPTION_KEY,
      deliveryId as string,
      undefined,
      fetchImpl,
    );

    const delivery = await getWebhookDeliveryById(db, deliveryId as string);
    expect(delivery?.status).toBe('failed');
    expect(delivery?.attempts).toBe(1);
    expect(delivery?.lastError).toContain('ENOTFOUND');
  });

  it('a disabled endpoint or one not subscribed to the event type gets no delivery row at all', async () => {
    const workspaceId = await seedWorkspace('none');
    await seedEndpoint(workspaceId, 'https://example.com/disabled', ['diagram.created'], false);
    await seedEndpoint(workspaceId, 'https://example.com/wrong-event', ['spec.generated']);

    const deliveryIds = await enqueueWebhookEvent(db, undefined, workspaceId, 'diagram.created', {
      diagramId: 'd-none',
    });

    expect(deliveryIds).toHaveLength(0);
  });

  it('when `jobs` is supplied, a failed delivery re-enqueues the same job with `startAfter` set to the computed retry time', async () => {
    const workspaceId = await seedWorkspace('requeue');
    await seedEndpoint(workspaceId, 'https://example.com/requeue', ['diagram.created']);
    const [deliveryId] = await enqueueWebhookEvent(db, undefined, workspaceId, 'diagram.created', {
      diagramId: 'd-requeue',
    });

    const sendCalls: unknown[] = [];
    const fakeJobs = {
      send: vi.fn(async (...args: unknown[]) => {
        sendCalls.push(args);
        return 'fake-job-id';
      }),
    } as unknown as import('../jobs/index.js').JobQueue;

    const fetchImpl = vi.fn(
      async () => new Response('server error', { status: 503 }),
    ) as unknown as typeof fetch;

    await deliverWebhookDelivery(
      db,
      TEST_ENCRYPTION_KEY,
      deliveryId as string,
      fakeJobs,
      fetchImpl,
    );

    expect(fakeJobs.send).toHaveBeenCalledTimes(1);
    const [, , options] = sendCalls[0] as [string, unknown, { startAfter: Date }];
    expect(options.startAfter).toBeInstanceOf(Date);
  });

  // NOTE: `deliverWebhookDelivery`'s "endpoint no longer exists" branch
  // (dead-letters immediately rather than retrying against a vanished
  // config) is defensive code that is structurally UNREACHABLE through this
  // schema's own FK (`webhook_deliveries.webhook_endpoint_id` has no `ON
  // DELETE CASCADE`, and T79's `deleteWebhookEndpoint` always deletes an
  // endpoint's deliveries first) — Postgres itself refuses to delete a
  // referenced endpoint while a delivery row still points at it. Not
  // exercised here for that reason; kept in `deliver.ts` as a safety net in
  // case that invariant is ever loosened.
});
