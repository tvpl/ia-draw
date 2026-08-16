import { encryptToken } from '@arch-canvas/ai-tools';
import { can } from '@arch-canvas/auth';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteSchemaMap } from '../../openapi/types.js';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import { generateOpaqueToken } from '../auth/tokens.js';
import '../auth/types.js';
import { resolveWorkspaceRole } from '../workspace/index.js';
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  getWebhookEndpointById,
  listWebhookEndpointsForWorkspace,
  rotateWebhookSecret,
  updateWebhookEndpoint,
  WEBHOOK_EVENT_TYPES,
  type WebhookEndpointRow,
} from './webhooks.js';

export interface WebhookModuleDeps {
  db: Db;
  /** Same envelope-encryption master key `ai-provider` (F2a) uses for `encrypted_token` — reused unchanged (T71/T79's documented decision: `encryptToken`/`decryptToken`, never `hashToken`, since the delivery worker must recover the plaintext secret to sign outbound requests). */
  encryptionKey: string;
}

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function forbidden(): never {
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

const workspaceIdParamsSchema = z.object({ id: z.string().min(1) });
const webhookIdParamsSchema = z.object({ id: z.string().min(1), webhookId: z.string().min(1) });

const eventsSchema = z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1);

const createBodySchema = z.object({
  url: z.string().min(1),
  events: eventsSchema,
  enabled: z.boolean().optional(),
});

const updateBodySchema = z
  .object({
    url: z.string().min(1).optional(),
    events: eventsSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (value) => value.url !== undefined || value.events !== undefined || value.enabled !== undefined,
    {
      message: 'at least one of "url", "events" or "enabled" must be provided',
    },
  );

/** OpenAPI schema map for this module's 5 routes (T18, API-01). */
export const routeSchemas: RouteSchemaMap = {
  'GET /workspaces/:id/webhooks': { params: workspaceIdParamsSchema },
  'POST /workspaces/:id/webhooks': { params: workspaceIdParamsSchema, body: createBodySchema },
  'PATCH /workspaces/:id/webhooks/:webhookId': {
    params: webhookIdParamsSchema,
    body: updateBodySchema,
  },
  'DELETE /workspaces/:id/webhooks/:webhookId': { params: webhookIdParamsSchema },
  'PATCH /workspaces/:id/webhooks/:webhookId(^[^:]+):rotate-secret': {
    params: webhookIdParamsSchema,
  },
};

/** Never includes `secretEncrypted` (or anything secret-shaped) — the API surface never re-exposes it after the one-shot reveal at creation/rotation. */
function toPublicWebhookEndpoint(row: WebhookEndpointRow) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    url: row.url,
    events: row.eventsJson,
    enabled: row.enabled,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Admin-only gate (EXT-02: "somente workspace_admin") — `workspace:manage_members`
 * is held exclusively by `workspace_admin`/`org_admin` among all 5 roles
 * (`packages/auth`'s `rbac.ts`), the exact same action `export/routes.ts`'s
 * EXP-04 bulk-export route and `share/routes.ts`'s `:revoke` admin path both
 * already gate on — reused here unchanged as the established "admin-level
 * action" convention.
 */
async function assertWorkspaceAdmin(db: Db, workspaceId: string, userId: string): Promise<void> {
  const role = await resolveWorkspaceRole(db, workspaceId, userId);
  if (!role) notFound();
  if (!can({ role }, 'workspace:manage_members', { workspaceId }).allowed) forbidden();
}

/**
 * Resolves the webhook endpoint identified by the route's `webhookId`,
 * scoped to the route's own `:id` workspace — a webhook belonging to a
 * DIFFERENT workspace than the URL claims is a 404 (IDOR), never a 403
 * that would confirm it exists elsewhere.
 */
async function resolveOwnedWebhook(
  db: Db,
  workspaceId: string,
  webhookId: string,
): Promise<WebhookEndpointRow> {
  const existing = await getWebhookEndpointById(db, webhookId);
  if (!existing || existing.workspaceId !== workspaceId) notFound();
  return existing;
}

/**
 * Registers the webhook module (T79, EXT-02): admin-only CRUD for
 * `webhook_endpoints`, plus one-shot HMAC secret reveal at creation and at
 * rotation. The delivery pipeline itself (T80) lives in `deliver.ts`.
 */
export function registerWebhookModule(app: FastifyInstance, deps: WebhookModuleDeps): void {
  const { db, encryptionKey } = deps;

  app.get('/workspaces/:id/webhooks', { preHandler: requireSession(db) }, async (request) => {
    const { id: workspaceId } = workspaceIdParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();

    await assertWorkspaceAdmin(db, workspaceId, user.id);

    const items = await listWebhookEndpointsForWorkspace(db, workspaceId);
    return { items: items.map(toPublicWebhookEndpoint) };
  });

  app.post(
    '/workspaces/:id/webhooks',
    { preHandler: requireSession(db) },
    async (request, reply) => {
      const { id: workspaceId } = workspaceIdParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      await assertWorkspaceAdmin(db, workspaceId, user.id);

      const body = createBodySchema.parse(request.body);
      const secret = generateOpaqueToken();
      const row = await createWebhookEndpoint(db, {
        workspaceId,
        url: body.url,
        events: body.events,
        enabled: body.enabled ?? true,
        createdBy: user.id,
        secretEncrypted: encryptToken(secret, encryptionKey),
      });

      reply.code(201);
      return { webhookEndpoint: toPublicWebhookEndpoint(row), secret };
    },
  );

  app.patch(
    '/workspaces/:id/webhooks/:webhookId',
    { preHandler: requireSession(db) },
    async (request) => {
      const { id: workspaceId, webhookId } = webhookIdParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      await assertWorkspaceAdmin(db, workspaceId, user.id);
      await resolveOwnedWebhook(db, workspaceId, webhookId);

      const body = updateBodySchema.parse(request.body);
      const row = await updateWebhookEndpoint(db, webhookId, body);
      if (!row) notFound();

      return { webhookEndpoint: toPublicWebhookEndpoint(row) };
    },
  );

  app.delete(
    '/workspaces/:id/webhooks/:webhookId',
    { preHandler: requireSession(db) },
    async (request, reply) => {
      const { id: workspaceId, webhookId } = webhookIdParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      await assertWorkspaceAdmin(db, workspaceId, user.id);
      await resolveOwnedWebhook(db, workspaceId, webhookId);

      const deleted = await deleteWebhookEndpoint(db, webhookId);
      if (!deleted) notFound();

      reply.code(204);
      return null;
    },
  );

  app.patch(
    '/workspaces/:id/webhooks/:webhookId(^[^:]+):rotate-secret',
    { preHandler: requireSession(db) },
    async (request) => {
      const { id: workspaceId, webhookId } = webhookIdParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      await assertWorkspaceAdmin(db, workspaceId, user.id);
      await resolveOwnedWebhook(db, workspaceId, webhookId);

      const secret = generateOpaqueToken();
      const row = await rotateWebhookSecret(db, webhookId, encryptToken(secret, encryptionKey));
      if (!row) notFound();

      return { webhookEndpoint: toPublicWebhookEndpoint(row), secret };
    },
  );
}
