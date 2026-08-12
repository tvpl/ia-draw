/** Structured pipeline errors (T53/T55) — every one carries `statusCode` so core's generic error handler (apps/server/src/core/server.ts) renders it as problem+json, matching every other module's `notFound()`/`forbidden()`/`SnapshotNotFoundError` convention. */

/** No enabled `ai_provider_configs` row exists for the diagram's workspace (or the global scope). `ai_runs.provider_config_id` is NOT NULL with a foreign key (F2a schema) — a run row can never be created for this failure, so it is surfaced directly, before any row exists. */
export class NoProviderConfiguredError extends Error {
  readonly statusCode = 424;
  constructor() {
    super('no enabled AI provider is configured for this workspace');
    this.name = 'NoProviderConfiguredError';
  }
}

/** `POST /ai/runs/{id}:approve` or `:cancel` against a run id that does not exist. */
export class AiRunNotFoundError extends Error {
  readonly statusCode = 404;
  constructor() {
    super('ai run not found');
    this.name = 'AiRunNotFoundError';
  }
}

/** `:approve`/`:cancel` called against a run whose status is not a valid source state for that action (e.g. approving an already-`applied` run). */
export class InvalidRunStateError extends Error {
  readonly statusCode = 409;
  constructor(action: string, status: string) {
    super(`cannot ${action} a run in status "${status}"`);
    this.name = 'InvalidRunStateError';
  }
}

/** AIE-03: the diagram's revision advanced past the run's frozen `sourceRevision` between preview and approval — the patch is never applied silently over the newer change. */
export class StaleRevisionError extends Error {
  readonly statusCode = 409;
  constructor() {
    super(
      'the diagram changed since this run was previewed — re-request generation before approving',
    );
    this.name = 'StaleRevisionError';
  }
}

/** `:approve` called against a run whose pending patch is no longer held in the server's in-memory `RunStore` (process restart, or a run older than the store's lifetime — see runStore.ts's docstring). */
export class PatchNotFoundError extends Error {
  readonly statusCode = 409;
  constructor() {
    super(
      "this run's pending patch is no longer available — re-request generation before approving",
    );
    this.name = 'PatchNotFoundError';
  }
}
