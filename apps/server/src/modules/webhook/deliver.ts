import { createHmac } from 'node:crypto';
import { decryptToken } from '@arch-canvas/ai-tools';
import { webhookDeliveries } from '@arch-canvas/database';
import { eq } from 'drizzle-orm';
import type { Db } from '../auth/db.js';
import { defineJob, enqueue, type JobQueue } from '../jobs/index.js';
import type { WebhookEventType } from './webhooks.js';
import { getWebhookEndpointById, listEnabledWebhookEndpointsForEvent } from './webhooks.js';

export const WEBHOOK_DELIVERY_JOB = 'deliver-webhook';

/** Header a receiving endpoint verifies the delivery against — `sha256=<hex hmac>`, the same shape GitHub/Stripe's own webhook signature headers use. */
export const WEBHOOK_SIGNATURE_HEADER = 'X-ArchCanvas-Signature';

/**
 * HMAC-SHA256 over the EXACT serialized string sent as the request body
 * (never a re-serialization of the parsed object, which could reorder keys
 * and desync the signature) — Node's native `crypto.createHmac`, the same
 * primitive `packages/ai-tools/src/crypto.ts` already uses for
 * encryption's key derivation (`createHash`), researched directly against
 * Node's `crypto` docs before use (Knowledge Verification Chain).
 */
export function signWebhookPayload(secret: string, serializedPayload: string): string {
  const digest = createHmac('sha256', secret).update(serializedPayload).digest('hex');
  return `sha256=${digest}`;
}

/**
 * Delay scheduled BEFORE the attempt whose 1-based ordinal indexes this
 * array — attempt 1 fails -> wait `BACKOFF_SCHEDULE_MS[0]` (1 min) before
 * attempt 2; attempt 4 fails -> wait `BACKOFF_SCHEDULE_MS[3]` (2 h) before
 * attempt 5. `MAX_DELIVERY_ATTEMPTS` (5) caps total attempts, matching the
 * task text's "1min/5min/30min/2h/12h, 5 tentativas": 4 of the 5 listed
 * delays are the gaps BETWEEN the 5 attempts; the 5th listed delay (12h) is
 * deliberately never scheduled since attempt 5 failing goes straight to
 * `dead_letter` — there is no 6th attempt to wait 12h for. Documented
 * design choice, not an off-by-one bug.
 */
export const BACKOFF_SCHEDULE_MS = [
  60_000, // 1 min
  5 * 60_000, // 5 min
  30 * 60_000, // 30 min
  2 * 60 * 60_000, // 2 h
  12 * 60 * 60_000, // 12 h — documented as unused headroom, see above
] as const;

export const MAX_DELIVERY_ATTEMPTS = 5;

/** Generous enough for a slow but healthy endpoint; short enough that one dead endpoint can't stall the worker indefinitely. */
const DELIVERY_TIMEOUT_MS = 10_000;

export interface WebhookDeliveryRow {
  id: string;
  webhookEndpointId: string;
  eventType: string;
  payloadJson: unknown;
  status: 'pending' | 'delivered' | 'failed' | 'dead_letter';
  attempts: number;
  nextRetryAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function getWebhookDeliveryById(
  db: Db,
  id: string,
): Promise<WebhookDeliveryRow | null> {
  const [row] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id));
  return (row as WebhookDeliveryRow) ?? null;
}

/**
 * Looks up every ENABLED webhook endpoint in `workspaceId` subscribed to
 * `eventType` (T79's `listEnabledWebhookEndpointsForEvent`) and inserts one
 * `pending` `webhook_deliveries` row per match, enqueuing the delivery job
 * for each only when `jobs` is supplied — the same optional `deps.jobs`
 * degrade already established by `compaction`/`bulkBundle` (F1c): omitting
 * the job queue leaves delivery rows sitting `pending` rather than being a
 * boot requirement. This is the single function every one of T80's 5
 * event-wiring call sites invokes; it never persists an event when zero
 * endpoints match (the normal case for a workspace with no webhooks
 * configured — not an error).
 */
export async function enqueueWebhookEvent(
  db: Db,
  jobs: JobQueue | undefined,
  workspaceId: string,
  eventType: WebhookEventType,
  payloadJson: unknown,
): Promise<string[]> {
  const endpoints = await listEnabledWebhookEndpointsForEvent(db, workspaceId, eventType);
  const deliveryIds: string[] = [];

  for (const endpoint of endpoints) {
    const [row] = await db
      .insert(webhookDeliveries)
      .values({
        webhookEndpointId: endpoint.id,
        eventType,
        payloadJson: payloadJson as object,
        status: 'pending',
      })
      .returning({ id: webhookDeliveries.id });
    if (!row) continue;

    deliveryIds.push(row.id);
    if (jobs) await enqueue(jobs, WEBHOOK_DELIVERY_JOB, { deliveryId: row.id });
  }

  return deliveryIds;
}

/**
 * Executes ONE delivery attempt for `deliveryId`: loads the delivery +
 * its endpoint, decrypts the endpoint's CURRENT secret (so a rotation
 * always signs with whatever is presently stored, T79), signs and POSTs
 * the exact same serialized payload, and updates the delivery row's
 * status/attempts/nextRetryAt/lastError based on the outcome. On a
 * schedulable failure (network error or non-2xx, attempts still under
 * `MAX_DELIVERY_ATTEMPTS`), re-enqueues the SAME job with pg-boss's own
 * `startAfter` set to the computed backoff delay (AD-006: retries stay on
 * pg-boss/Postgres, never a bespoke poller) — only when `jobs` is supplied,
 * matching every other job in this codebase's optional-degrade contract.
 */
export async function deliverWebhookDelivery(
  db: Db,
  encryptionKey: string,
  deliveryId: string,
  jobs: JobQueue | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const delivery = await getWebhookDeliveryById(db, deliveryId);
  if (!delivery) return; // deleted between enqueue and processing — nothing to deliver.
  if (delivery.status === 'delivered' || delivery.status === 'dead_letter') return; // already terminal.

  const endpoint = await getWebhookEndpointById(db, delivery.webhookEndpointId);
  if (!endpoint) {
    // The endpoint was deleted after this delivery was enqueued — nothing
    // left to sign/deliver against; dead-letter immediately rather than
    // retrying forever against a config that no longer exists.
    await db
      .update(webhookDeliveries)
      .set({
        status: 'dead_letter',
        nextRetryAt: null,
        lastError: 'webhook endpoint no longer exists',
        updatedAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    return;
  }

  const serializedPayload = JSON.stringify(delivery.payloadJson);
  const secret = decryptToken(endpoint.secretEncrypted, encryptionKey);
  const signature = signWebhookPayload(secret, serializedPayload);

  let delivered = false;
  let errorMessage: string | null = null;
  try {
    const response = await fetchImpl(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [WEBHOOK_SIGNATURE_HEADER]: signature,
      },
      body: serializedPayload,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    delivered = response.ok;
    if (!delivered) errorMessage = `endpoint responded with HTTP ${response.status}`;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'network error';
  }

  const attempts = delivery.attempts + 1;

  if (delivered) {
    await db
      .update(webhookDeliveries)
      .set({
        status: 'delivered',
        attempts,
        nextRetryAt: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    return;
  }

  if (attempts >= MAX_DELIVERY_ATTEMPTS) {
    await db
      .update(webhookDeliveries)
      .set({
        status: 'dead_letter',
        attempts,
        nextRetryAt: null,
        lastError: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    return;
  }

  const scheduleIndex = Math.min(attempts - 1, BACKOFF_SCHEDULE_MS.length - 1);
  const delayMs = BACKOFF_SCHEDULE_MS[scheduleIndex] as number;
  const nextRetryAt = new Date(Date.now() + delayMs);

  await db
    .update(webhookDeliveries)
    .set({
      status: 'failed',
      attempts,
      nextRetryAt,
      lastError: errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(webhookDeliveries.id, deliveryId));

  if (jobs) {
    await enqueue(jobs, WEBHOOK_DELIVERY_JOB, { deliveryId }, { startAfter: nextRetryAt });
  }
}

/** Registers the `deliver-webhook` pg-boss worker (T28's wiring pattern, same shape as `registerCompactionJob`/`registerBulkBundleJob`). */
export async function registerWebhookDeliveryJob(
  jobs: JobQueue,
  db: Db,
  encryptionKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await defineJob(jobs, WEBHOOK_DELIVERY_JOB, async (payload: { deliveryId: string }) => {
    await deliverWebhookDelivery(db, encryptionKey, payload.deliveryId, jobs, fetchImpl);
  });
}
