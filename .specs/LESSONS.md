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
- evidence: FND-05 (traceability) (+1 more)
- last seen: 2026-08-12T04:07:17Z

### L-005 - A static source-scan test (import/call-site pattern matching) proves the absence of code-level egress calls in this repo, not runtime network enforcement — don't mark a network/egress-isolation AC Verified on a static guardrail alone; it needs real runtime enforcement (firewall, network policy, egress proxy) or an explicit re-scope in spec.md.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `infra` · harmful: 0
- features: architecture-canvas
- evidence: apps/server/src/core/no-egress.spec.ts (infra) (infra)
- last seen: 2026-08-12T04:20:39Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
