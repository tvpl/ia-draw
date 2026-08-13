# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - When a change-detection condition combines multiple fields with OR, test each field changing alone, not just all fields changing together, or the OR/AND boundary is untested.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `domain-logic` · harmful: 0
- features: architecture-canvas
- evidence: packages/editor-adapter/src/computeDiff.ts:50 (domain-logic)
- last seen: 2026-08-12T04:07:09Z

### L-002 - Don't leave a network/egress-isolation acceptance criterion evidenced only by the current absence of outbound calls — add an explicit automated check before any feature that could add an external call lands.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `infra` · harmful: 0
- features: architecture-canvas
- evidence: FND-02 (infra)
- last seen: 2026-08-12T04:07:17Z

### L-003 - A benchmark or spike task must not be traced as covering an AC that requires a server-side flow the spike itself doesn't build; keep the requirement's status at Implementing until the real flow exists.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `traceability` · harmful: 0
- features: architecture-canvas
- evidence: EDT-01 (traceability)
- last seen: 2026-08-12T04:07:17Z

### L-004 - When an AC bundles multiple subsystems or formats into one requirement, verify and trace each subsystem/format independently rather than advancing the whole AC's status on partial coverage.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `traceability` · harmful: 0
- features: architecture-canvas
- evidence: FND-05 (traceability) (+2 more)
- last seen: 2026-08-12T17:55:26Z

### L-005 - A static source-scan test (import/call-site pattern matching) proves the absence of code-level egress calls in this repo, not runtime network enforcement — don't mark a network/egress-isolation AC Verified on a static guardrail alone; it needs real runtime enforcement (firewall, network policy, egress proxy) or an explicit re-scope in spec.md.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `infra` · harmful: 0
- features: architecture-canvas
- evidence: apps/server/src/core/no-egress.spec.ts (infra) (infra)
- last seen: 2026-08-12T04:20:39Z

### L-006 - When a spec AC requires enforcement on both REST and WebSocket operations but only the REST surface exists in the current wave, keep the requirement at Implementing and flag the WebSocket half as an explicit spec-precision gap instead of marking the AC fully Verified.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `backend-auth` · harmful: 0
- features: architecture-canvas
- evidence: AUTH-02 (spec.md:87), AUTH-05 (spec.md:90) (backend-auth)
- last seen: 2026-08-12T05:13:26Z

### L-007 - A task that only builds an AC's supporting infrastructure (e.g. an audit table and insert helper) does not satisfy an AC whose literal text describes an end-to-end behavior (reject + record); keep the AC at Implementing until the actual enforcement route exists and is tested.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `backend-auth` · harmful: 0
- features: architecture-canvas
- evidence: AUTH-03 (spec.md:88) (backend-auth)
- last seen: 2026-08-12T05:13:32Z

### L-008 - A module's routes being reachable through per-test hand-registration is not evidence the production entrypoint wires them — boot the real compiled entrypoint under plain node (not only Vitest's bundler-mediated resolution) at least once per feature wave that adds a new server module, and curl a route from each newly-added module.
- signal: `gate_fail` · recurrence: 1 feature(s) · scope: `server-wiring` · harmful: 0
- features: architecture-canvas
- evidence: apps/server/src/index.ts (pre-fix, commits e8b7bf6~1 through a8d8927) (server-wiring)
- last seen: 2026-08-12T07:17:54Z

### L-009 - When a spec's Independent Test narrative states a specific count but the formal AC only requires a qualitative guarantee (e.g. 'every confirmed change'), a reduced-count E2E test is acceptable only if the in-file comment argues the mechanism is count-invariant — flag the divergence explicitly in the validation report rather than silently matching the narrative number or silently reducing it.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `e2e-scoping` · harmful: 0
- features: architecture-canvas
- evidence: REC-01 (spec.md Independent Test narrative vs. formal AC text) (e2e-scoping)
- last seen: 2026-08-12T07:18:00Z

### L-010 - When a server-side domain package must avoid a workspace dependency's runtime footprint (e.g. a browser-oriented rendering library pulled in transitively), keep only import type from that dependency and reimplement the minimal logic locally, then verify zero runtime coupling by grepping the compiled dist output for import/require statements, not just by reading source-level import type annotations.
- signal: `spec_deviation` · recurrence: 1 feature(s) · scope: `package-boundaries` · harmful: 0
- features: architecture-canvas
- evidence: packages/diagram-domain/src/mergeScene.ts:1-29 (SPEC_DEVIATION docstring) (package-boundaries)
- last seen: 2026-08-12T07:18:07Z

### L-011 - When implementing file import/bundle unpacking (zip, tar, etc.), always enforce a decompressed-size or compression-ratio cap before writing extracted content, even when no task explicitly names 'zip bomb' — check spec.md Edge Cases for storage-expansion attacks whenever a task adds an unzip/decompress code path.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `apps/server/src/modules/export` · harmful: 0
- features: architecture-canvas
- evidence: spec.md Edge Cases (zip bomb) - apps/server/src/modules/export/import.ts, bundle.ts (apps/server/src/modules/export)
- last seen: 2026-08-12T09:37:18Z

### L-012 - When a spec's acceptance criterion lists mutually-possible categories (e.g. 'added/removed/moved/modified') without defining precedence for an item that qualifies for more than one, document the chosen precedence rule in the implementation and flag it explicitly as a spec-precision gap in the validation report rather than resolving it silently.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `packages/diagram-domain` · harmful: 0
- features: architecture-canvas
- evidence: spec.md VER-04 - packages/diagram-domain/src/structuralDiff.ts:30-38 (packages/diagram-domain)
- last seen: 2026-08-12T09:37:18Z

### L-013 - For a 'secret never in response' guarantee, assert the response object lacks the secret-bearing field entirely (not.toHaveProperty), not just that it lacks the raw plaintext as a substring — a ciphertext field can leak undetected past a substring-only check.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `security` · harmful: 0
- features: architecture-canvas
- evidence: apps/server/src/modules/ai-provider/providerConfigs.ts:26-35 (security)
- last seen: 2026-08-12T17:55:26Z

### L-014 - When an AC states a property at scale (e.g. 'zero X and zero Y up to N elements'), the property-based sweep must assert every named dimension inside the same loop, not just the dimensions the task's own Done-when happened to list — a task's Done-when can narrow an AC's literal wording without anyone noticing.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `packages/diagram-ir` · harmful: 0
- features: architecture-canvas
- evidence: AIG-03 / packages/diagram-ir/src/metrics.spec.ts:300-314 (packages/diagram-ir)
- last seen: 2026-08-12T18:45:32Z

### L-015 - AI-run pending-patch state (RunStore) kept in-process/in-memory is fine for single-instance MVP but must move to persisted storage before horizontal scaling or restart-heavy deploys, since a lost entry forces the user to re-request generation (structurally safe, but a real UX/durability gap under load).
- signal: `spec_deviation` · recurrence: 1 feature(s) · scope: `apps/server/src/modules/ai-engine` · harmful: 0
- features: architecture-canvas
- evidence: apps/server/src/modules/ai-engine/runStore.ts:12 (apps/server/src/modules/ai-engine)
- last seen: 2026-08-12T20:35:14Z

### L-016 - When sensor-mutating a pnpm-workspace package consumed cross-package via node_modules symlinks (e.g. packages/ai-tools from apps/server), a wholesale symlinked node_modules in the scratch worktree follows the relative symlink chain back to the REAL repo's dist, silently making the mutation a no-op; re-point the specific @scope/pkg symlink at the scratch copy and rebuild it there before running the affected tests.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `verification-methodology` · harmful: 0
- features: architecture-canvas
- evidence: packages/ai-tools/src/tools/types.ts:139 (verifier sensor mutation #3, false negative on first attempt) (verification-methodology)
- last seen: 2026-08-12T20:38:24Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
