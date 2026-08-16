---
description: Run the capability-map and route-inventory audit (repo-tools)
allowed-tools: Bash(pnpm --filter @arch-canvas/repo-tools run audit)
---

Run the repository audit and report the result to the user.

1. Run `pnpm --filter @arch-canvas/repo-tools run audit`.
2. This regenerates `docs/route-inventory.md` and checks:
   - every `docs/capability-map.yaml` entry against the real code (TRU-03, UIX-01) — a `ui_surface`
     that doesn't exist in `apps/web/src`, or a capability wrongly marked `backend-only`, fails it;
   - every workspace package that has `test:unit` declares a coverage floor (CIQ-04).
3. If it exits non-zero, show every offending line verbatim (never summarize away which entry or
   package failed) and stop — do not edit the capability map or coverage config to make it pass
   without first understanding why it diverged from the code.
4. If it exits zero, report the totals it printed (routes, consumed, pending-product) and confirm
   `docs/route-inventory.md` was regenerated.

Run this before closing any wave that touches `apps/server` routes, `apps/web` consumers, or
`docs/capability-map.yaml` — it's the same check CI runs in `capability-audit`.
