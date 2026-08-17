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

### L-017 - A scanning tool's scan root is an assumption, not a fact — assert the tool's total against an independent count over the whole source tree before publishing the number.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `repo-tooling` · harmful: 0
- features: platform-maturity
- evidence: UIX-01 (round 1) — tools/repo-tools/src/serverRoutes.ts:22 (repo-tooling)
- last seen: 2026-08-16T11:02:44Z

### L-018 - A path-existence check is not a semantic check — assert a property only the correct file has, because a gate that proves a file exists still passes when the file is the wrong one.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `repo-tooling` · harmful: 0
- features: platform-maturity
- evidence: sensor N2 — tools/repo-tools/src/capabilityMap.ts:27 (repo-tooling)
- last seen: 2026-08-16T11:02:44Z

### L-019 - When an implementation deliberately diverges from an acceptance criterion, amend the criterion in the same commit — a divergence recorded only in tasks.md reads as verified coverage at validation time.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `traceability` · harmful: 0
- features: platform-maturity
- evidence: CIQ-03 (round 1) — .github/workflows/ci.yaml:133 (traceability)
- last seen: 2026-08-16T11:02:44Z

### L-020 - A declared threshold is only a gate when the runner is configured to measure it — assert that the enforcement switch is on and the value is meaningful, not merely that the number is declared.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `ci` · harmful: 0
- features: platform-maturity
- evidence: sensor N14, N15 — packages/diagram-domain/vitest.config.ts:22 (ci)
- last seen: 2026-08-16T11:02:44Z

### L-021 - When an acceptance criterion names a concrete deliverable artifact, ship that artifact or amend the criterion — an index promising the artifact in a later round is not the artifact.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `traceability` · harmful: 0
- features: platform-maturity
- evidence: UIX-02 — .specs/features/platform-maturity/ui-roadmap.md (traceability)
- last seen: 2026-08-16T11:02:44Z

### L-022 - Before documenting a workspace script invocation as `pnpm --filter <pkg> <script>` in onboarding docs or slash commands, run it verbatim once — a script name that collides with one of pnpm's own built-in commands (audit, add, update, list, ...) is silently intercepted unless invoked as `pnpm --filter <pkg> run <script>`.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `agent-onboarding` · harmful: 0
- features: platform-maturity
- evidence: AGT-05 / .claude/commands/audit.md:8 (agent-onboarding)
- last seen: 2026-08-16T11:39:04Z

### L-023 - Prose-only onboarding artifacts (CLAUDE.md sections, slash-command bodies) have no lint or CI surface over their content, so a stale invariant or a broken documented command ships silently until a human or agent happens to run it — treat any such command as untrusted until it has actually been executed, not just read.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `agent-onboarding` · harmful: 0
- features: platform-maturity
- evidence: F7 discrimination sensor / CLAUDE.md, .claude/commands/*.md (agent-onboarding)
- last seen: 2026-08-16T11:39:04Z

### L-024 - When a batch worker isolates a suspected pre-existing gate failure with git stash of only the most recently added files, re-verify against the true wave-start commit in a separate worktree before trusting the pre-existing/unrelated classification — stashing a few files still leaves the rest of the wave's diff in place and can hide a regression the wave itself caused.
- signal: `gate_fail` · recurrence: 1 feature(s) · scope: `verification-methodology` · harmful: 0
- features: platform-maturity
- evidence: apps/server/vitest.config.ts:26 (F8 wave, CIQ-04 functions ratchet) (verification-methodology)
- last seen: 2026-08-16T13:25:54Z

### L-025 - A scanning tool's scan root is an assumption, not a fact — assert the tool's total against an independent count over the whole source tree before publishing the number.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `repo-tooling` · harmful: 0
- features: platform-maturity
- evidence: design.md:34 (F8, corrected by tasks.md T21-T23/Phase 2d) (repo-tooling)
- last seen: 2026-08-16T13:25:59Z

### L-026 - When a task plan adds a new route module, task it to explicitly wire that module's routeSchemas into every cross-cutting registry file (module registration AND the OpenAPI schema registry) in the same task that creates the routes — a plan that names only one wiring point lets the other go silently unwired until an audit tool catches it.
- signal: `spec_deviation` · recurrence: 1 feature(s) · scope: `task-planning` · harmful: 0
- features: platform-maturity
- evidence: tasks.md:525-535 (T17 orchestrator note); apps/server/src/openapi/registry.ts (task-planning)
- last seen: 2026-08-16T17:46:09Z

### L-027 - When an acceptance criterion has two clauses, assert both: the request emission is usually tested and the resulting state is usually skipped.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `web` · harmful: 0
- features: ai-dock
- evidence: DOCK-18, DOCK-14, DOCK-08, DOCK-04 (.specs/features/ai-dock/validation.md) (web)
- last seen: 2026-08-16T21:47:52Z

### L-028 - A generator that writes a committed artifact must run the repo formatter over its own output, or the next lint gate fails on a file nobody edited.
- signal: `gate_fail` · recurrence: 1 feature(s) · scope: `repo-tooling` · harmful: 0
- features: ai-dock
- evidence: .specs/features/ai-dock/validation.md Gate Check (docs/openapi.json format error, commit 9b1efae) (repo-tooling)
- last seen: 2026-08-16T21:47:59Z

### L-029 - When a criterion caps a visible list, state whether the remainder is rendered inside a scroll container or dropped — 'the rest reachable by scrolling' is not decidable against a slice.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `traceability` · harmful: 0
- features: ai-dock
- evidence: .specs/features/ai-dock/spec.md Edge Cases (>50 elements) vs apps/web/src/ai-dock/AiDock.tsx:160 (traceability)
- last seen: 2026-08-16T21:47:59Z

### L-030 - When an acceptance criterion names an ARIA attribute or live region, assert that attribute in the test, not just that the message text renders.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `a11y` · harmful: 0
- features: sso-sign-in
- evidence: apps/web/src/auth/LoginPage.tsx:115 (mutant M5, SSO-20) (a11y)
- last seen: 2026-08-16T22:27:30Z

### L-031 - When an acceptance criterion describes an action on the resource currently being viewed, scope a page-level action for it - per-row actions on that resource's children never satisfy it.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `ui` · harmful: 0
- features: workspace-navigation
- evidence: NAV-21 (.specs/features/workspace-navigation/validation.md, P1 Arquivar table) (ui)
- last seen: 2026-08-17T00:45:57Z

### L-032 - Keyboard-reachability criteria need an explicit Tab/Enter test - an axe violations check evidences static accessibility properties only, never reachability.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `a11y` · harmful: 0
- features: workspace-navigation
- evidence: NAV-24 (.specs/features/workspace-navigation/validation.md, P2 table) (a11y)
- last seen: 2026-08-17T00:45:57Z

### L-033 - A criterion covering two locales needs a test that renders in the non-default locale - asserting only the default locale's strings leaves it uncovered.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `i18n` · harmful: 0
- features: workspace-navigation
- evidence: NAV-26 (.specs/features/workspace-navigation/validation.md, P2 table) (i18n)
- last seen: 2026-08-17T00:45:58Z

### L-034 - When a criterion names two required outcomes, assert both - a test covering only the first half leaves the criterion partly unevidenced.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: workspace-navigation
- evidence: NAV-18, NAV-25 (.specs/features/workspace-navigation/validation.md) (tests)
- last seen: 2026-08-17T00:45:58Z

### L-035 - When a spec requires an aria-live announcement on both success and failure of a write action, add a test that drives the client through the failure branch and asserts the failure announcement text, not just the success branch.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `web/a11y-announcements` · harmful: 0
- features: component-library
- evidence: apps/web/src/library/MetadataPanel.tsx:104-106 (web/a11y-announcements)
- last seen: 2026-08-17T02:31:49Z

### L-036 - When a spec requires every action to be keyboard-reachable, assert focusability for each named interactive control individually rather than only a sample of them.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `web/a11y-keyboard` · harmful: 0
- features: component-library
- evidence: CLIB-18 (web/a11y-keyboard)
- last seen: 2026-08-17T02:31:49Z

### L-037 - Trace an acceptance criterion phrased about the screen to a screen-level test; a child component's callback assertion does not cover it.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `apps/web` · harmful: 0
- features: workspace-webhooks
- evidence: WHK-17 - WorkspaceWebhooksPage.tsx:246 (no screen-level evidence) (apps/web)
- last seen: 2026-08-17T03:41:31Z

### L-038 - Assert that dismissing a one-time reveal removes the sensitive value from the document, not just that the dismiss callback fired.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `apps/web` · harmful: 0
- features: workspace-webhooks
- evidence: Sensor M2 - WorkspaceWebhooksPage.tsx:246 onDismiss no-op survived (apps/web)
- last seen: 2026-08-17T03:41:31Z

### L-039 - When a test asserts that a user-selected value reaches the request body, pick a value the code could not plausibly hardcode (never the field's default or first option), or an implementation that ignores the user's choice passes unchanged.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `web` · harmful: 0
- features: share-links
- evidence: .specs/features/share-links/validation.md:M7 (apps/web/src/share/ShareLinkPanel.spec.tsx:106) (web)
- last seen: 2026-08-17T07:01:56Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
