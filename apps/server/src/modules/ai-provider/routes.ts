import { decryptToken, encryptToken, validateProviderBaseUrl } from '@arch-canvas/ai-tools';
import { recordAuditEvent, workspaceMembers } from '@arch-canvas/database';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createRateLimitPreHandler, InMemoryRateLimiter } from '../../core/rateLimit.js';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import '../auth/types.js';
import { resolveWorkspaceRole } from '../workspace/index.js';
import {
  createProviderConfig,
  getProviderConfigInternal,
  getProviderConfigPublic,
  listProviderConfigs,
  updateProviderConfig,
} from './providerConfigs.js';
import { testProviderConnection } from './testConnection.js';

export interface AiProviderModuleDeps {
  db: Db;
  encryptionKey: string;
  /** Deployment-level allowlist for baseUrls that would otherwise resolve to a blocked range (AIC-03's "allowlist corporativo explícito"). Empty by default — SSRF protection is on unless an operator deliberately opts a host in. */
  baseUrlAllowlist?: string[];
  /** Injectable for tests — defaults to the real global `fetch` in production. */
  fetchImpl?: typeof fetch;
  /** Injectable rate limiter — defaults to a fresh in-memory limiter (10 test-connection calls / 60s per admin) so the module works standalone with no extra wiring. */
  testConnectionRateLimiter?: InMemoryRateLimiter;
}

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function forbidden(): never {
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

function badRequest(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

const GLOBAL_SCOPE = 'global';

async function hasOrgAdminMembership(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.role, 'org_admin')));
  return Boolean(row);
}

/**
 * Authorizes `userId` to administer AI provider configs for `scope`
 * (AIC-01/AIC-02: "só org_admin/workspace_admin"). `scope === "global"`
 * requires org_admin membership in ANY workspace (this codebase has no
 * separate organization-level membership table — org_admin is the highest
 * workspace role, used here as the org-wide admin proxy). Any other scope
 * is treated as a workspaceId: no membership → 404 (IDOR, AUTH-04);
 * membership below org_admin/workspace_admin → 403.
 */
async function assertProviderAdmin(db: Db, userId: string, scope: string): Promise<void> {
  if (scope === GLOBAL_SCOPE) {
    if (!(await hasOrgAdminMembership(db, userId))) forbidden();
    return;
  }
  const role = await resolveWorkspaceRole(db, scope, userId);
  if (!role) notFound();
  if (role !== 'org_admin' && role !== 'workspace_admin') forbidden();
}

const listQuerySchema = z.object({ scope: z.string().min(1).optional() });
const idParamsSchema = z.object({ id: z.string().min(1) });
const createBodySchema = z.object({
  scope: z.string().min(1),
  baseUrl: z.string().min(1),
  model: z.string().min(1),
  token: z.string().min(1),
  capabilitiesJson: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});
const updateBodySchema = z.object({
  baseUrl: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  token: z.string().min(1).optional(),
  capabilitiesJson: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

/**
 * Registers the AI provider admin module (T42): CRUD for
 * `ai_provider_configs` (token never appears in any response) and
 * "Testar conexão". Only `org_admin`/`workspace_admin` may reach any route
 * here.
 */
export function registerAiProviderModule(app: FastifyInstance, deps: AiProviderModuleDeps): void {
  const { db, encryptionKey } = deps;
  const allowlist = deps.baseUrlAllowlist ?? [];
  const fetchImpl = deps.fetchImpl ?? fetch;
  const testConnectionLimiter =
    deps.testConnectionRateLimiter ?? new InMemoryRateLimiter({ limit: 10, windowMs: 60_000 });
  const rateLimited = createRateLimitPreHandler(
    testConnectionLimiter,
    (request) => request.authContext?.user?.id ?? request.ip,
  );

  app.get('/admin/ai-providers', { preHandler: requireSession(db) }, async (request) => {
    const { scope } = listQuerySchema.parse(request.query);
    const user = request.authContext?.user;
    if (!user) forbidden();

    await assertProviderAdmin(db, user.id, scope ?? GLOBAL_SCOPE);
    const items = await listProviderConfigs(db, scope);
    return { items };
  });

  app.post('/admin/ai-providers', { preHandler: requireSession(db) }, async (request, reply) => {
    const user = request.authContext?.user;
    if (!user) forbidden();
    const body = createBodySchema.parse(request.body);

    await assertProviderAdmin(db, user.id, body.scope);

    const ssrfCheck = await validateProviderBaseUrl(body.baseUrl, allowlist);
    if (!ssrfCheck.allowed) badRequest(`baseUrl rejected: ${ssrfCheck.reason}`);

    const encryptedToken = encryptToken(body.token, encryptionKey);
    const config = await createProviderConfig(db, {
      scope: body.scope,
      baseUrl: body.baseUrl,
      model: body.model,
      encryptedToken,
      capabilitiesJson: body.capabilitiesJson,
      enabled: body.enabled,
    });

    await recordAuditEvent(db, {
      actorId: user.id,
      action: 'ai_provider_config.created',
      resourceType: 'ai_provider_config',
      resourceId: config.id,
      metadataJson: { scope: body.scope, baseUrl: body.baseUrl, model: body.model },
    });

    reply.code(201);
    return { config };
  });

  app.patch('/admin/ai-providers/:id', { preHandler: requireSession(db) }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();

    const existing = await getProviderConfigPublic(db, id);
    if (!existing) notFound();
    await assertProviderAdmin(db, user.id, existing.scope);

    const body = updateBodySchema.parse(request.body);
    if (body.baseUrl) {
      const ssrfCheck = await validateProviderBaseUrl(body.baseUrl, allowlist);
      if (!ssrfCheck.allowed) badRequest(`baseUrl rejected: ${ssrfCheck.reason}`);
    }

    const config = await updateProviderConfig(db, id, {
      baseUrl: body.baseUrl,
      model: body.model,
      encryptedToken: body.token ? encryptToken(body.token, encryptionKey) : undefined,
      capabilitiesJson: body.capabilitiesJson,
      enabled: body.enabled,
    });
    if (!config) notFound();

    await recordAuditEvent(db, {
      actorId: user.id,
      action: 'ai_provider_config.updated',
      resourceType: 'ai_provider_config',
      resourceId: id,
      metadataJson: { fieldsChanged: Object.keys(body) },
    });

    return { config };
  });

  app.post(
    '/admin/ai-providers/:id(^[^:]+):test',
    { preHandler: [requireSession(db), rateLimited] },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();

      const existing = await getProviderConfigPublic(db, id);
      if (!existing) notFound();
      await assertProviderAdmin(db, user.id, existing.scope);

      // Internal-only read (carries encryptedToken) — decrypted straight into a
      // local variable used only as the outbound Authorization header; never
      // logged, persisted, or placed on the result returned below.
      const internal = await getProviderConfigInternal(db, id);
      if (!internal) notFound();
      const token = decryptToken(internal.encryptedToken, encryptionKey);

      const result = await testProviderConnection(
        existing.baseUrl,
        existing.model,
        token,
        fetchImpl,
      );

      await recordAuditEvent(db, {
        actorId: user.id,
        action: 'ai_provider_config.tested',
        resourceType: 'ai_provider_config',
        resourceId: id,
        metadataJson: {
          success: result.success,
          modelAvailable: result.modelAvailable,
          toolCallingSupported: result.toolCallingSupported,
        },
      });

      return result;
    },
  );
}
