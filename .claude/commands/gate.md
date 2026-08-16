---
description: Run the local pre-push gate (lint + typecheck + unit + integration tests)
allowed-tools: Bash(make lint), Bash(make typecheck), Bash(make test-unit), Bash(make test-integration), Bash(make ci)
---

Run the same gate every task in this project's `tasks.md` files points to as "Done when" evidence.

1. Try `make ci` first (lint + typecheck + test-unit + test-integration — identical to
   `.github/workflows/ci.yaml`).
2. If it fails with a spawn `ENOENT` for `pg_lsclusters` or `redis-server` (missing host daemons,
   not a code problem), fall back to running the steps individually:
   `make lint && make typecheck && make test-unit`, then `make test-integration` separately if
   PGlite is available (it needs no Docker daemon — ADR-0007).
3. Report which commands ran, their exit codes, and the test counts from their output — never
   claim the gate passed without showing the actual result.
4. A non-zero exit on any step means the gate failed: stop and fix before treating the current
   task as done, per this repo's `tlc-spec-driven` execution contract.
