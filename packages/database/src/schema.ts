import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
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

export const diagramSnapshotKind = pgEnum('diagram_snapshot_kind', [
  'auto',
  'named',
  'published',
  'pre_ai',
  'restore_point',
]);

/**
 * Op-log append-only (design.md "Data Models", EDT-03/04, REC-04/05). The
 * only writer is `diagram-sync`'s `operations:batch` route (T22), always
 * inside the same transaction that computes `sequence`.
 *
 * `(diagram_id, client_mutation_id)` UNIQUE is the idempotency invariant
 * (EDT-04): resubmitting the same `clientMutationId` can never produce a
 * second row. `(diagram_id, sequence)` is also UNIQUE — one integer per
 * position in a diagram's op-log, never assigned twice — so a
 * monotonicity bug in the sequence-computing transaction (T22) fails loudly
 * at the database instead of silently corrupting the log.
 */
export const diagramOperations = pgTable(
  'diagram_operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    diagramId: uuid('diagram_id')
      .notNull()
      .references(() => diagrams.id),
    sequence: integer('sequence').notNull(),
    clientMutationId: uuid('client_mutation_id').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    baseRevision: integer('base_revision').notNull(),
    elementsDeltaJson: jsonb('elements_delta_json').notNull(),
    operationSummaryJson: jsonb('operation_summary_json').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('diagram_operations_diagram_client_mutation_unique').on(
      table.diagramId,
      table.clientMutationId,
    ),
    uniqueIndex('diagram_operations_diagram_sequence_unique').on(table.diagramId, table.sequence),
  ],
);

/**
 * Compacted materializations + named/published versions (design.md "Data
 * Models", VER-01). Real compaction logic lands in F1c; this wave only
 * needs the schema to exist and be insertable.
 */
export const diagramSnapshots = pgTable(
  'diagram_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    diagramId: uuid('diagram_id')
      .notNull()
      .references(() => diagrams.id),
    revision: integer('revision').notNull(),
    kind: diagramSnapshotKind('kind').notNull(),
    name: text('name'),
    sceneJsonKey: text('scene_json_key').notNull(),
    checksum: text('checksum').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    immutable: boolean('immutable').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('diagram_snapshots_diagram_revision_idx').on(table.diagramId, table.revision)],
);

export const diagramAssetStatus = pgEnum('diagram_asset_status', ['pending', 'ready']);

/**
 * Uploaded binary assets referenced by canvas elements (EDT-06). Two-phase
 * upload: `assets:initiate` inserts a `pending` row with a signed-URL
 * `objectKey`; `assets:complete` confirms the object landed (`headObject`),
 * computes `checksum`, and flips the row to `ready`. `operations:batch`
 * (T22) rejects any delta referencing an asset that is not `ready` — an
 * image element is never ACKed with a broken reference.
 *
 * Dedup is scoped per `workspaceId` (design.md "asset module": "dedup por
 * checksum no tenant") — a second upload with the same SHA-256 in the same
 * workspace repoints its `objectKey` to the first `ready` asset's object
 * instead of keeping a second physical copy referenced.
 */
export const diagramAssets = pgTable(
  'diagram_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    diagramId: uuid('diagram_id')
      .notNull()
      .references(() => diagrams.id),
    status: diagramAssetStatus('status').notNull().default('pending'),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes'),
    objectKey: text('object_key').notNull(),
    checksum: text('checksum'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('diagram_assets_workspace_checksum_idx').on(table.workspaceId, table.checksum)],
);

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

/**
 * Semantic metadata attached to a canvas element by `elementId` — entirely in
 * the platform's own model, never touching upstream Excalidraw types or
 * fields (LIB-02, design.md "diagram_elements_meta ... carrega a semântica
 * fora dos tipos upstream"). Composite primary key `(diagram_id, element_id)`
 * makes writes idempotent per element — a second PATCH for the same element
 * updates the same row instead of creating a duplicate (T38 "Done when").
 */
export const diagramElementsMeta = pgTable(
  'diagram_elements_meta',
  {
    diagramId: uuid('diagram_id')
      .notNull()
      .references(() => diagrams.id),
    elementId: text('element_id').notNull(),
    semanticType: text('semantic_type'),
    metadataJson: jsonb('metadata_json').notNull().default({}),
    revision: integer('revision').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.diagramId, table.elementId] })],
);

/**
 * A component library — either global (`workspace_id IS NULL`, the seeded
 * `library-content` manifest) or workspace-scoped (LIB-01/LIB-02).
 */
export const libraries = pgTable('libraries', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id),
  name: text('name').notNull(),
  version: text('version').notNull(),
  license: text('license').notNull(),
  manifestJson: jsonb('manifest_json').notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One component inside a `libraries` row, resolvable by `stable_key`
 * (design.md `compile(ir, library)` resolves components by this key — the
 * unique index below is what makes that resolution unambiguous per
 * library).
 */
export const libraryItems = pgTable(
  'library_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    libraryId: uuid('library_id')
      .notNull()
      .references(() => libraries.id),
    stableKey: text('stable_key').notNull(),
    version: text('version').notNull(),
    sceneJson: jsonb('scene_json').notNull().default({}),
    metadataJson: jsonb('metadata_json').notNull().default({}),
    iconKey: text('icon_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('library_items_library_stable_key_unique').on(table.libraryId, table.stableKey),
  ],
);
