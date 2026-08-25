import { can, type Role } from '@arch-canvas/auth';
import { recordAuditEvent, users, workspaces as workspacesTable } from '@arch-canvas/database';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteSchemaMap } from '../../openapi/types.js';
import type { Db } from '../auth/db.js';
import { requireSession } from '../auth/middleware.js';
import '../auth/types.js';
import type { JobQueue } from '../jobs/index.js';
import { LastAdminError } from './lastAdmin.js';
import {
  addWorkspaceMember,
  listWorkspaceMembers,
  readMemberRole,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
} from './members.js';
import {
  addOrganizationAdmin,
  LastOrgAdminError,
  listOrganizationAdmins,
  removeOrganizationAdmin,
} from './organizationAdmins.js';
import { registerProjectAndDiagramRoutes } from './project-diagram-routes.js';
import { isUniqueViolation, resolveWorkspaceRole } from './rbac.js';
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspaceById,
  listWorkspacesForUser,
  updateWorkspace,
} from './workspaces.js';

export interface WorkspaceModuleDeps {
  db: Db;
  /** Threaded straight through to `registerProjectAndDiagramRoutes` (T80's `diagram.created` webhook wiring) — same optional degrade as everywhere else. */
  jobs?: JobQueue;
}

const ROLE_VALUES = ['org_admin', 'workspace_admin', 'editor', 'reviewer', 'viewer'] as const;
const roleSchema = z.enum(ROLE_VALUES);

const createWorkspaceBodySchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
});
const updateWorkspaceBodySchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
});
const workspaceIdParamsSchema = z.object({ id: z.string().min(1) });
const memberParamsSchema = z.object({ id: z.string().min(1), userId: z.string().min(1) });
const addMemberBodySchema = z.object({ userId: z.string().min(1), role: roleSchema });
const updateMemberBodySchema = z.object({ role: roleSchema });
const addOrganizationAdminBodySchema = z.object({ email: z.string().min(1) });

function notFound(): never {
  throw Object.assign(new Error('Not Found'), { statusCode: 404 });
}

function forbidden(): never {
  throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

function conflict(detail: string): never {
  throw Object.assign(new Error(detail), { statusCode: 409 });
}

/**
 * OpenAPI schema map for this file's 9 routes (T6, API-01). The project and
 * diagram routes `registerProjectAndDiagramRoutes` registers separately
 * (`project-diagram-routes.ts`) are outside this file's own registrations
 * and out of this wave's `routes.ts`-only coverage (design.md).
 */
export const routeSchemas: RouteSchemaMap = {
  'GET /workspaces': {},
  'POST /workspaces': { body: createWorkspaceBodySchema },
  'GET /workspaces/:id': { params: workspaceIdParamsSchema },
  'PATCH /workspaces/:id': { params: workspaceIdParamsSchema, body: updateWorkspaceBodySchema },
  'DELETE /workspaces/:id': { params: workspaceIdParamsSchema },
  'GET /workspaces/:id/members': { params: workspaceIdParamsSchema },
  'POST /workspaces/:id/members': { params: workspaceIdParamsSchema, body: addMemberBodySchema },
  'PATCH /workspaces/:id/members/:userId': {
    params: memberParamsSchema,
    body: updateMemberBodySchema,
  },
  'DELETE /workspaces/:id/members/:userId': { params: memberParamsSchema },
  'GET /workspaces/:id/organization-admins': { params: workspaceIdParamsSchema },
  'POST /workspaces/:id/organization-admins': {
    params: workspaceIdParamsSchema,
    body: addOrganizationAdminBodySchema,
  },
  'DELETE /workspaces/:id/organization-admins/:userId': { params: memberParamsSchema },
};

/**
 * Loads the actor's role for `workspaceId`, or throws 404 when there is no
 * membership row (AUTH-04: never reveal whether the workspace exists).
 */
async function requireMembership(db: Db, workspaceId: string, userId: string): Promise<Role> {
  const role = await resolveWorkspaceRole(db, workspaceId, userId);
  if (!role) notFound();
  return role;
}

/** The organization that owns `workspaceId` — same lookup shape as `effectiveRole.ts`/`lastAdmin.ts`. */
async function resolveOrganizationId(db: Db, workspaceId: string): Promise<string> {
  const [owner] = await db
    .select({ organizationId: workspacesTable.organizationId })
    .from(workspacesTable)
    .where(eq(workspacesTable.id, workspaceId));
  if (!owner) notFound();
  return owner.organizationId;
}

/**
 * Registers workspace + workspace-member CRUD (T16) and project + diagram
 * metadata CRUD (T17), all RBAC-gated and audit-logged.
 */
export function registerWorkspaceModule(app: FastifyInstance, deps: WorkspaceModuleDeps): void {
  const { db, jobs } = deps;
  registerProjectAndDiagramRoutes(app, { db, jobs });

  app.get('/workspaces', { preHandler: requireSession(db) }, async (request) => {
    const user = request.authContext?.user;
    if (!user) forbidden();
    const items = await listWorkspacesForUser(db, user.id);
    return { items };
  });

  app.post('/workspaces', { preHandler: requireSession(db) }, async (request, reply) => {
    const user = request.authContext?.user;
    if (!user) forbidden();
    const body = createWorkspaceBodySchema.parse(request.body);

    let workspace: Awaited<ReturnType<typeof createWorkspace>>;
    try {
      workspace = await createWorkspace(db, user.id, body);
    } catch (error) {
      if (isUniqueViolation(error)) conflict(`workspace slug '${body.slug}' is already taken`);
      throw error;
    }

    await recordAuditEvent(db, {
      actorId: user.id,
      action: 'workspace.created',
      resourceType: 'workspace',
      resourceId: workspace.id,
    });

    reply.code(201);
    return { workspace };
  });

  app.get('/workspaces/:id', { preHandler: requireSession(db) }, async (request) => {
    const { id } = workspaceIdParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();
    const role = await requireMembership(db, id, user.id);

    const decision = can({ role }, 'workspace:read', { workspaceId: id });
    if (!decision.allowed) notFound();

    const workspace = await getWorkspaceById(db, id, role);
    if (!workspace) notFound();
    return { workspace };
  });

  app.patch('/workspaces/:id', { preHandler: requireSession(db) }, async (request) => {
    const { id } = workspaceIdParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();
    const role = await requireMembership(db, id, user.id);

    const decision = can({ role }, 'workspace:write', { workspaceId: id });
    if (!decision.allowed) forbidden();

    const body = updateWorkspaceBodySchema.parse(request.body);
    let workspace: Awaited<ReturnType<typeof updateWorkspace>>;
    try {
      workspace = await updateWorkspace(db, id, body);
    } catch (error) {
      if (isUniqueViolation(error)) conflict(`workspace slug '${body.slug}' is already taken`);
      throw error;
    }
    if (!workspace) notFound();

    await recordAuditEvent(db, {
      actorId: user.id,
      action: 'workspace.updated',
      resourceType: 'workspace',
      resourceId: id,
    });

    return { workspace };
  });

  app.delete('/workspaces/:id', { preHandler: requireSession(db) }, async (request, reply) => {
    const { id } = workspaceIdParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();
    const role = await requireMembership(db, id, user.id);

    const decision = can({ role }, 'workspace:write', { workspaceId: id });
    if (!decision.allowed) forbidden();

    const deleted = await deleteWorkspace(db, id);
    if (!deleted) notFound();

    await recordAuditEvent(db, {
      actorId: user.id,
      action: 'workspace.deleted',
      resourceType: 'workspace',
      resourceId: id,
    });

    reply.code(204);
    return null;
  });

  app.get('/workspaces/:id/members', { preHandler: requireSession(db) }, async (request) => {
    const { id } = workspaceIdParamsSchema.parse(request.params);
    const user = request.authContext?.user;
    if (!user) forbidden();
    const role = await requireMembership(db, id, user.id);

    const decision = can({ role }, 'workspace:read', { workspaceId: id });
    if (!decision.allowed) notFound();

    const items = await listWorkspaceMembers(db, id);
    return { items };
  });

  app.post(
    '/workspaces/:id/members',
    { preHandler: requireSession(db) },
    async (request, reply) => {
      const { id } = workspaceIdParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();
      const role = await requireMembership(db, id, user.id);

      const decision = can({ role }, 'workspace:manage_members', { workspaceId: id });
      if (!decision.allowed) forbidden();

      const body = addMemberBodySchema.parse(request.body);
      let member: Awaited<ReturnType<typeof addWorkspaceMember>>;
      try {
        member = await addWorkspaceMember(db, id, body.userId, body.role);
      } catch (error) {
        if (isUniqueViolation(error)) conflict('user is already a member of this workspace');
        throw error;
      }

      await recordAuditEvent(db, {
        actorId: user.id,
        action: 'workspace.member.added',
        resourceType: 'workspace',
        resourceId: id,
        metadataJson: { targetUserId: body.userId, role: body.role },
      });

      reply.code(201);
      return { member };
    },
  );

  app.patch(
    '/workspaces/:id/members/:userId',
    { preHandler: requireSession(db) },
    async (request) => {
      const { id, userId: targetUserId } = memberParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();
      const role = await requireMembership(db, id, user.id);

      const decision = can({ role }, 'workspace:manage_members', { workspaceId: id });
      if (!decision.allowed) forbidden();

      const body = updateMemberBodySchema.parse(request.body);
      // RBAC-11: read before the change, so the audit records what the role WAS.
      const previousRole = await readMemberRole(db, id, targetUserId);
      let updated: boolean;
      try {
        updated = await updateWorkspaceMemberRole(db, id, targetUserId, body.role);
      } catch (error) {
        if (error instanceof LastAdminError) conflict(error.message);
        throw error;
      }
      if (!updated) notFound();

      await recordAuditEvent(db, {
        actorId: user.id,
        action: 'workspace.member.updated',
        resourceType: 'workspace',
        resourceId: id,
        metadataJson: { targetUserId, role: body.role, previousRole },
      });

      return { ok: true };
    },
  );

  app.delete(
    '/workspaces/:id/members/:userId',
    { preHandler: requireSession(db) },
    async (request, reply) => {
      const { id, userId: targetUserId } = memberParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();
      const role = await requireMembership(db, id, user.id);

      const decision = can({ role }, 'workspace:manage_members', { workspaceId: id });
      if (!decision.allowed) forbidden();

      const previousRole = await readMemberRole(db, id, targetUserId);
      let removed: boolean;
      try {
        removed = await removeWorkspaceMember(db, id, targetUserId);
      } catch (error) {
        if (error instanceof LastAdminError) conflict(error.message);
        throw error;
      }
      if (!removed) notFound();

      await recordAuditEvent(db, {
        actorId: user.id,
        action: 'workspace.member.removed',
        resourceType: 'workspace',
        resourceId: id,
        metadataJson: { targetUserId, previousRole },
      });

      reply.code(204);
      return null;
    },
  );

  // ORG-05..11: organization-wide admin grant/revoke, backed by organization_members
  // (design.md "Módulo do servidor") — same /workspaces prefix, no new route prefix (AD-013
  // satisfied by construction).
  app.get(
    '/workspaces/:id/organization-admins',
    { preHandler: requireSession(db) },
    async (request) => {
      const { id } = workspaceIdParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();
      // ORG-05: any member of the workspace may read the list (universal read).
      await requireMembership(db, id, user.id);

      const organizationId = await resolveOrganizationId(db, id);
      const items = await listOrganizationAdmins(db, organizationId);
      return { items };
    },
  );

  app.post(
    '/workspaces/:id/organization-admins',
    { preHandler: requireSession(db) },
    async (request, reply) => {
      const { id } = workspaceIdParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();
      const role = await requireMembership(db, id, user.id);
      // ORG-06/09: only someone who IS org_admin (not merely workspace_admin) here may grant
      // organization-wide admin — a direct identity check, not a new `can()` Action, since
      // workspace_admin and org_admin share the same grant set in packages/auth (design.md).
      if (role !== 'org_admin') forbidden();

      const body = addOrganizationAdminBodySchema.parse(request.body);
      const [target] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, body.email));
      if (!target) {
        throw Object.assign(new Error('No user found for that email'), { statusCode: 404 });
      }

      const organizationId = await resolveOrganizationId(db, id);
      await addOrganizationAdmin(db, organizationId, target.id);

      await recordAuditEvent(db, {
        actorId: user.id,
        action: 'organization.admin.added',
        resourceType: 'organization',
        resourceId: organizationId,
        metadataJson: { targetUserId: target.id },
      });

      reply.code(201);
      return { ok: true };
    },
  );

  app.delete(
    '/workspaces/:id/organization-admins/:userId',
    { preHandler: requireSession(db) },
    async (request, reply) => {
      const { id, userId: targetUserId } = memberParamsSchema.parse(request.params);
      const user = request.authContext?.user;
      if (!user) forbidden();
      const role = await requireMembership(db, id, user.id);
      if (role !== 'org_admin') forbidden();

      const organizationId = await resolveOrganizationId(db, id);
      let removed: boolean;
      try {
        removed = await removeOrganizationAdmin(db, organizationId, targetUserId);
      } catch (error) {
        if (error instanceof LastOrgAdminError) conflict(error.message);
        throw error;
      }
      if (!removed) notFound();

      await recordAuditEvent(db, {
        actorId: user.id,
        action: 'organization.admin.removed',
        resourceType: 'organization',
        resourceId: organizationId,
        metadataJson: { targetUserId },
      });

      reply.code(204);
      return null;
    },
  );
}
