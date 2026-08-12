import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** RBAC roles (docs/product-spec.md §9.2). */
export const workspaceMemberRole = pgEnum('workspace_member_role', [
  'org_admin',
  'workspace_admin',
  'editor',
  'reviewer',
  'viewer',
]);

export const diagramStatus = pgEnum('diagram_status', [
  'draft',
  'in_review',
  'approved',
  'archived',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    status: text('status').notNull().default('active'),
    authSubject: text('auth_subject'),
    /** Argon2id hash for local email/password accounts (AUTH-01); null for OIDC-only users. */
    passwordHash: text('password_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_unique').on(table.email)],
);

/** Opaque session cookie store — immediately revocable, no client-side JWT (design.md Tech Decisions). */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('sessions_token_hash_unique').on(table.tokenHash)],
);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  settingsJson: jsonb('settings_json').notNull().default({}),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    accessPolicy: text('access_policy').notNull().default('private'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('workspaces_slug_unique').on(table.slug)],
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: workspaceMemberRole('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workspace_members_workspace_user_unique').on(table.workspaceId, table.userId),
  ],
);

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'),
  classification: text('classification'),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Append-only audit trail (AUTH-03). No `updated_at` — rows are never
 * mutated after insert; `recordAuditEvent` (tx.ts) is the only writer and
 * only ever INSERTs.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    ipHash: text('ip_hash'),
    metadataJson: jsonb('metadata_json').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_resource_idx').on(table.resourceType, table.resourceId),
    index('audit_events_created_at_idx').on(table.createdAt),
  ],
);

export const diagrams = pgTable('diagrams', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  title: text('title').notNull(),
  description: text('description'),
  status: diagramStatus('status').notNull().default('draft'),
  currentRevision: integer('current_revision').notNull().default(0),
  schemaVersion: text('schema_version').notNull().default('v1'),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id),
  thumbnailKey: text('thumbnail_key'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Single-use WebSocket handshake tickets (AUTH-02, design.md Tech Decisions).
 * `consumeWsTicket` marks `used_at` via one atomic
 * `UPDATE ... WHERE used_at IS NULL RETURNING` so a race between two
 * concurrent consume attempts can never both succeed.
 */
export const wsTickets = pgTable(
  'ws_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    diagramId: uuid('diagram_id')
      .notNull()
      .references(() => diagrams.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('ws_tickets_token_hash_unique').on(table.tokenHash)],
);
