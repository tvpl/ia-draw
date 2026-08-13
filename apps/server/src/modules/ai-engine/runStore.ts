import type { AbstractPatch } from '@arch-canvas/ai-tools';

/**
 * In-process store for a run's pending abstract patch, keyed by `ai_runs.id`
 * (T53/T54/T55). `ai_runs` (F2a schema, docs/product-spec.md §6) has no
 * column for the proposed patch itself — only the audit-trail columns
 * (`prompt_redacted`, `usage_json`, `error_code`) — so the patch a run
 * proposes lives here between "previewing" (T53/T54, computed once per
 * request) and ":approve"/":cancel" (T55, a later request against the same
 * server process).
 *
 * SPEC_DEVIATION: this is a known, documented limitation, not an oversight —
 * adding a schema column is out of this batch's scope (no migration task
 * exists in tasks-f2c.md's T53-T57), and every one of T55's own "Done when"
 * criteria is satisfiable without one. The tradeoff: a pending run's patch
 * does not survive a server restart or a request landing on a different
 * server instance behind a load balancer. `:approve`/`:cancel` against a run
 * whose entry has been evicted (or the process restarted) fail with a
 * structured 409 (`PatchNotFoundError`, applyPatch.ts) — never a silent
 * no-op — so this can never cause an AI patch to apply incorrectly, only to
 * require the user to re-request generation.
 */
export interface PendingRunEntry {
  patch: AbstractPatch;
  /** ElementIds selected on the canvas when the run was created — the "seleção originalmente solicitada" AIE-02 checks proposed changes against. */
  selection: string[];
  /** The diagram revision the patch was computed against — frozen at creation, matches `ai_runs.source_revision` (AIE-03). */
  sourceRevision: number;
  /** Set by T54's preview step; absent until then. */
  requiresExplicitApproval?: boolean;
}

/** A fresh, empty store — one instance per `registerAiEngineModule` call (mirrors `InMemoryRateLimiter`'s injectable-singleton pattern in ai-provider/rateLimit.ts). */
export class RunStore {
  private readonly entries = new Map<string, PendingRunEntry>();

  set(runId: string, entry: PendingRunEntry): void {
    this.entries.set(runId, entry);
  }

  get(runId: string): PendingRunEntry | undefined {
    return this.entries.get(runId);
  }

  /** Merges `patch` onto an existing entry — used by T54's preview step to attach `requiresExplicitApproval` without re-supplying the whole entry. */
  update(runId: string, patch: Partial<PendingRunEntry>): void {
    const existing = this.entries.get(runId);
    if (!existing) return;
    this.entries.set(runId, { ...existing, ...patch });
  }

  delete(runId: string): void {
    this.entries.delete(runId);
  }
}
