import { webhookDeliveries, webhookEndpoints } from '@arch-canvas/database';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

/**
 * The 5 event types documented in `docs/product-spec.md` §7.3 ("Eventos
 * assinados"). This is the single source of truth both `eventsJson`
 * validation (T79) and every event-wiring call site (T80) are checked
 * against.
 */
export const WEBHOOK_EVENT_TYPES = [
  'diagram.created',
  'diagram.updated',
  'diagram.published',
  'spec.generated',
  'comment.mentioned',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export function isWebhookEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

export interface WebhookEndpointRow {
  id: string;
  workspaceId: string;
  url: string;
  secretEncrypted: string;
  eventsJson: unknown;
  enabled: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWebhookEndpointInput {
  workspaceId: string;
  url: string;
  events: WebhookEventType[];
  enabled: boolean;
  createdBy: string;
  secretEncrypted: string;
}

/** Inserts a new webhook endpoint row — `secretEncrypted` is the ONLY persisted form of the HMAC secret, never the plaintext (T79's one-shot-reveal requirement, same discipline as `share_links.token_hash`). */
export async function createWebhookEndpoint(
  db: Db,
  input: CreateWebhookEndpointInput,
): Promise<WebhookEndpointRow> {
  const [row] = await db
    .insert(webhookEndpoints)
    .values({
      workspaceId: input.workspaceId,
      url: input.url,
      secretEncrypted: input.secretEncrypted,
      eventsJson: input.events,
      enabled: input.enabled,
      createdBy: input.createdBy,
    })
    .returning();
  if (!row) throw new Error('failed to insert webhook endpoint');
  return row as WebhookEndpointRow;
}

export async function listWebhookEndpointsForWorkspace(
  db: Db,
  workspaceId: string,
): Promise<WebhookEndpointRow[]> {
  return db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.workspaceId, workspaceId))
    .orderBy(desc(webhookEndpoints.createdAt)) as Promise<WebhookEndpointRow[]>;
}

export async function getWebhookEndpointById(
  db: Db,
  id: string,
): Promise<WebhookEndpointRow | null> {
  const [row] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id));
  return (row as WebhookEndpointRow) ?? null;
}

export interface UpdateWebhookEndpointInput {
  url?: string;
  events?: WebhookEventType[];
  enabled?: boolean;
}

/** Never touches `secretEncrypted` — secret rotation is exclusively `rotateWebhookSecret`'s job, kept as a deliberately separate, narrower write path. */
export async function updateWebhookEndpoint(
  db: Db,
  id: string,
  input: UpdateWebhookEndpointInput,
): Promise<WebhookEndpointRow | null> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.url !== undefined) patch.url = input.url;
  if (input.events !== undefined) patch.eventsJson = input.events;
  if (input.enabled !== undefined) patch.enabled = input.enabled;

  const [row] = await db
    .update(webhookEndpoints)
    .set(patch)
    .where(eq(webhookEndpoints.id, id))
    .returning();
  return (row as WebhookEndpointRow) ?? null;
}

/** Replaces the stored `secretEncrypted` with a freshly encrypted one (T79's `:rotate-secret`) — the old secret stops validating signatures immediately, no dual-secret grace period (documented simplification, still satisfies "rotacionável"). */
export async function rotateWebhookSecret(
  db: Db,
  id: string,
  secretEncrypted: string,
): Promise<WebhookEndpointRow | null> {
  const [row] = await db
    .update(webhookEndpoints)
    .set({ secretEncrypted, updatedAt: new Date() })
    .where(eq(webhookEndpoints.id, id))
    .returning();
  return (row as WebhookEndpointRow) ?? null;
}

/**
 * Deletes a webhook endpoint. `webhook_deliveries.webhook_endpoint_id` has
 * no `ON DELETE CASCADE` (schema.ts, T71) — its history rows are deleted
 * first so the endpoint row itself never fails on a FK violation.
 */
export async function deleteWebhookEndpoint(db: Db, id: string): Promise<boolean> {
  await db.delete(webhookDeliveries).where(eq(webhookDeliveries.webhookEndpointId, id));
  const rows = await db
    .delete(webhookEndpoints)
    .where(eq(webhookEndpoints.id, id))
    .returning({ id: webhookEndpoints.id });
  return rows.length > 0;
}

/**
 * Every ENABLED endpoint in `workspaceId` subscribed to `eventType` — the
 * lookup T80's event-wiring call sites run before inserting a
 * `webhook_deliveries` row. Filters `eventsJson` (a plain JSON array) in
 * application code rather than a Postgres jsonb containment operator —
 * simpler, DB-agnostic (works identically against PGlite in tests and real
 * Postgres in production), and workspace webhook-endpoint counts are small.
 */
export async function listEnabledWebhookEndpointsForEvent(
  db: Db,
  workspaceId: string,
  eventType: WebhookEventType,
): Promise<WebhookEndpointRow[]> {
  const rows = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.workspaceId, workspaceId), eq(webhookEndpoints.enabled, true)));
  return (rows as WebhookEndpointRow[]).filter(
    (row) => Array.isArray(row.eventsJson) && row.eventsJson.includes(eventType),
  );
}
