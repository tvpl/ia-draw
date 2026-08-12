import {
  type AnyPgColumn,
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

/** AI run state machine (design.md "Estados do run", AIE-05). */
export const aiRunStatus = pgEnum('ai_run_status', [
  'queued',
  'building_context',
  'calling_model',
  'validating',
  'previewing',
  'awaiting_approval',
  'applying',
  'applied',
  'failed',
  'cancelled',
  'rejected',
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

/**
 * An AI provider configuration (AIC-01) — org-wide or workspace-scoped,
 * `scope` holding either the literal `"global"` or a `workspaceId`. The
 * token is **never** stored in plaintext: `encrypted_token` is the only
 * column carrying it, always AES-256-GCM ciphertext produced by
 * `packages/ai-tools` (T41). No column here is named `token`/`secret` in
 * plain form — the schema itself is the guarantee (T40 "Done when").
 */
export const aiProviderConfigs = pgTable('ai_provider_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  scope: text('scope').notNull(),
  baseUrl: text('base_url').notNull(),
  model: text('model').notNull(),
  encryptedToken: text('encrypted_token').notNull(),
  capabilitiesJson: jsonb('capabilities_json').notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One AI generation/edit run (AIE-05) — `source_revision` freezes the base
 * the patch was computed against (design.md "Relationships-chave"),
 * `prompt_redacted`/`usage_json` never carry the provider token, and
 * `status` follows the state machine in design.md ("Estados do run").
 */
export const aiRuns = pgTable(
  'ai_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    diagramId: uuid('diagram_id')
      .notNull()
      .references(() => diagrams.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    providerConfigId: uuid('provider_config_id')
      .notNull()
      .references(() => aiProviderConfigs.id),
    sourceRevision: integer('source_revision').notNull(),
    status: aiRunStatus('status').notNull().default('queued'),
    promptRedacted: text('prompt_redacted'),
    usageJson: jsonb('usage_json').notNull().default({}),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('ai_runs_diagram_idx').on(table.diagramId)],
);

/**
 * One tool call inside an `ai_runs` row (AIE-01/05) — `arguments_redacted`
 * never carries the provider token or raw untrusted element text verbatim;
 * `sequence` orders calls within the run, mirroring `diagram_operations`'
 * per-scope sequence convention.
 */
export const aiToolCalls = pgTable(
  'ai_tool_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    aiRunId: uuid('ai_run_id')
      .notNull()
      .references(() => aiRuns.id),
    toolName: text('tool_name').notNull(),
    argumentsRedacted: jsonb('arguments_redacted').notNull().default({}),
    resultSummary: text('result_summary'),
    approved: boolean('approved').notNull().default(false),
    sequence: integer('sequence').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('ai_tool_calls_ai_run_idx').on(table.aiRunId)],
);

export const specDocumentStatus = pgEnum('spec_document_status', [
  'draft',
  'current',
  'superseded',
]);

/**
 * A generated Markdown spec version for a diagram (DOC-01/02, F3/T59). Never
 * updated in place — `docgen`'s `:generate`/`:regenerate-section` routes
 * (T62/T63) always INSERT a new row with an incremented `version`, flipping
 * the diagram's prior `'current'` row to `'superseded'` in the same
 * transaction (immutable-version discipline, same spirit as
 * `diagram_snapshots.immutable`). `sourceRevision` freezes the
 * `diagrams.current_revision` the Markdown was generated against.
 * `(diagram_id, version)` UNIQUE makes a duplicate version impossible.
 */
export const specDocuments = pgTable(
  'spec_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    diagramId: uuid('diagram_id')
      .notNull()
      .references(() => diagrams.id),
    sourceRevision: integer('source_revision').notNull(),
    version: integer('version').notNull(),
    markdownKey: text('markdown_key').notNull(),
    status: specDocumentStatus('status').notNull().default('draft'),
    generatedBy: uuid('generated_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('spec_documents_diagram_version_unique').on(table.diagramId, table.version),
  ],
);

export const commentStatus = pgEnum('comment_status', ['open', 'resolved']);

/**
 * A threaded async comment on a diagram (CMT-01/02, F3/T59), optionally
 * anchored to a canvas `elementId` or a presentation `frameId` (both free
 * text — not FKs — since a comment can outlive the element/frame it was
 * originally anchored to, same "don't hard-fail on a stale pointer"
 * philosophy as `diagram_elements_meta.element_id`). `parentId` is a
 * self-referencing FK: a null `parentId` is a thread root, a non-null one is
 * a reply. `role: 'reviewer'` is explicitly PERMITTED on `comment:create`/
 * `comment:resolve` even though it is denied `diagram:mutate` (packages/auth
 * policy, wired in T69) — a comment is never a scene mutation.
 */
export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    diagramId: uuid('diagram_id')
      .notNull()
      .references(() => diagrams.id),
    elementId: text('element_id'),
    frameId: uuid('frame_id'),
    parentId: uuid('parent_id').references((): AnyPgColumn => comments.id),
    body: text('body').notNull(),
    status: commentStatus('status').notNull().default('open'),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('comments_diagram_element_idx').on(table.diagramId, table.elementId)],
);

/**
 * A named, orderable "walkthrough" of a diagram (PRS-01/02/03, F3/T59) —
 * frames are added below. `publishedSnapshotId` is null until `:publish`
 * (T66) creates an immutable `diagram_snapshots` row (`kind: 'published'`)
 * and links it here; a published presentation's read-only link always
 * serves that snapshot's frozen scene, never the live one.
 * `settingsJson` carries presentation-level config (e.g. `expiresAt` for the
 * published link) without a schema change per new setting.
 */
export const presentations = pgTable('presentations', {
  id: uuid('id').primaryKey().defaultRandom(),
  diagramId: uuid('diagram_id')
    .notNull()
    .references(() => diagrams.id),
  name: text('name').notNull(),
  publishedSnapshotId: uuid('published_snapshot_id').references(() => diagramSnapshots.id),
  settingsJson: jsonb('settings_json').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One frame (a "slide") inside a `presentations` row (PRS-01/03, F3/T59).
 * References a canvas area via `elementId` (an Excalidraw `frame` element)
 * or a logical `frameId` (both free text, same stale-pointer tolerance as
 * `diagram_elements_meta`) — never both required, the route layer (T65)
 * validates exactly one is meaningful per frame. `position` is the
 * reorderable ordering key (PATCH in bulk reassigns it). `notes` are private
 * (never returned to a viewer without edit/presenter permission — enforced
 * at the route layer, T65/T66). `navLinksJson` holds `{ targetFrameId }[]`
 * click-through links to other frames in the same presentation.
 */
export const presentationFrames = pgTable(
  'presentation_frames',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    presentationId: uuid('presentation_id')
      .notNull()
      .references(() => presentations.id),
    elementId: text('element_id'),
    frameId: text('frame_id'),
    position: integer('position').notNull(),
    notes: text('notes'),
    navLinksJson: jsonb('nav_links_json').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('presentation_frames_presentation_position_idx').on(table.presentationId, table.position),
  ],
);
