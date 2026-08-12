# Architecture Canvas Validation — F0 Foundation Wave

> **Scope**: This report validates ONLY the F0 (Fundação) wave — tasks T1 through T11, diff range
> `e4aff3a..HEAD`. It does NOT validate the full architecture-canvas feature; F1/F2/F3/F4 waves are
> unimplemented (see spec.md Requirement Traceability — 71 of 77 requirements remain `Pending`) and
> will receive their own validation run(s) appended to this file's history when executed.

**Date**: 2026-08-12
**Spec**: `.specs/features/architecture-canvas/spec.md`
**Diff range**: `e4aff3a..HEAD` (11 commits, `chore(repo): scaffold pnpm monorepo...` through `feat(fixtures): add deterministic 1k/5k scene generator and bootstrap baseline`)
**Verifier**: independent sub-agent (author ≠ verifier) — fresh session, no access to prior agents' chat transcripts

---

## Task Completion

| Task | Status | Commit | Notes |
| ---- | ------ | ------ | ----- |
| T1 | ✅ Done | `235b53a` | Monorepo scaffold, gate build verde |
| T2 | ✅ Done | `c859aa0` | shared-contracts, 17 unit tests |
| T3 | ✅ Done | `3f7a423` | Fastify core, config, health, shutdown |
| T4 | ✅ Done | `a382498` | web scaffold, vite build verified |
| T5 | ✅ Done | `33933cc` | database schema + migration, 5 integration tests (PGlite, `SPEC_DEVIATION` documented) |
| T6 | ✅ Done | `727cc9a` | compose stack; `docker compose config` static validation only (no daemon in sandbox — independently re-confirmed, see Edge Cases) |
| T7 | ✅ Done | `881ee0e` | CI workflow (5 jobs); not executed on GitHub Actions from this sandbox |
| T8 | ✅ Done | `25fe90f` | 6 ADRs |
| T9 | ✅ Done | `649e506` | editor-adapter spike: computeDiff, applyRemote, round-trip |
| T10 | ✅ Done | `8a75ecc` | server-side render spike: SVG (exportToSvg) + PNG (resvg) |
| T11 | ✅ Done | `d5fe705` | 1k/5k scene generator + benchmark baseline |

All 11 commit hashes exist in `git log e4aff3a..HEAD` (verified by direct comparison against `git log --oneline` output). All tasks in `tasks.md` carry a `**Status**: ✅ Complete` line with commit evidence.

---

## Spec-Anchored Acceptance Criteria

Scope: FND-01, FND-02, FND-03, FND-05 (P1: Instalação self-hosted — FND-04 excluded, its traceability
status is `In Tasks` not `Implementing`, no F0 task claims it), EDT-07 (P1: Edição server-first, AC7),
EXP-01 (P1: Export e salvamento local, AC1), EDT-01 (P1: Edição server-first, AC1) plus the adjacent
Edge Case it partially de-risks. AUTH-* skipped per scope (F1, not claimed by this wave).

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion expression | Result |
| --- | --- | --- | --- |
| FND-01: WHEN `cp .env.example .env && docker compose up --build` on a clean machine THEN usable at single public URL, all healthchecks green | Full end-to-end healthy stack reachable at one URL | `infra/compose/compose.yaml` (proxy/server/web/postgres/minio/migrate services + healthchecks defined); independently re-ran `docker compose -f compose.yaml config` in this session → exit 0, resolved cleanly against `.env.example`. **No Docker daemon available in this sandbox** (`docker version` server half fails to connect to `/var/run/docker.sock` — confirmed independently), so `up --build` and the healthchecks turning green were never executed, only statically validated | ⚠️ Not executable in this sandbox — statically validated only |
| FND-02: The system SHALL operate with outbound internet blocked except the configured AI base URL | Runtime network isolation enforced (or at minimum architecturally absent-by-design) | No compose `network_mode`, egress policy, firewall rule, or automated test found anywhere in `infra/` or the test suite (`grep -rn "internet\|egress\|outbound\|network_mode" infra/` → no matches). `infra/compose/README.md` and T6's task status assert "nenhuma dependência de rede em runtime nos serviços" as a design claim only, not an enforced or tested property | ❌ GAP — no `file:line` evidence; evidence-or-zero applies |
| FND-03: IF production starts with a known dev default secret THEN refuse to boot with explanatory error naming the variable | `loadConfig` throws, error message names the specific env var | `apps/server/src/core/config.ts:34-43` (throws `Refusing to start in production: ${varName} is still set to the known development placeholder...`); `apps/server/src/core/config.spec.ts:13-20` — `expect(() => loadConfig({NODE_ENV:'production', SESSION_SECRET: INSECURE_DEV_SECRET, ...})).toThrowError(/SESSION_SECRET/)`; `config.spec.ts:23-30` — same for `ENCRYPTION_KEY`. **Confirmed by discrimination sensor** (mutation 2, killed) | ✅ PASS |
| FND-05: The system SHALL expose separate liveness/readiness endpoints and drain WebSocket connections and jobs on graceful shutdown | `/health/live` always 200; `/health/ready` reflects dependency state; SIGTERM drains connections before exit | `apps/server/src/core/server.ts:33` (`/health/live` → `{status:'ok'}` unconditionally); `server.ts:35-53` (`/health/ready` returns 503 + `status:'degraded'` when any dependency check fails); `apps/server/src/core/server.spec.ts:19-25` — `expect(response.statusCode).toBe(200)` for live; `server.spec.ts:40-57` — `expect(response.statusCode).toBe(503)` + exact `dependencies` array for degraded ready; `server.ts:82-97` + `server.spec.ts:92-111` — `registerGracefulShutdown` closes the Fastify instance (drains HTTP connections) strictly before `onShutdownComplete` fires (`closeOrder < exitOrder`, asserted). **WebSocket connections and job draining are literally unbuilt in F0** — no WS server, no job queue exist yet (both are F1/pg-boss scope per spec.md Assumptions table); the AC's WS/jobs clause has zero evidence | ⚠️ Spec-precision gap — HTTP drain + health split fully proven; WS/jobs draining clause not yet applicable/covered |
| EDT-07: The system SHALL integrate Excalidraw exclusively through the editor-adapter package, never importing internal upstream paths | No `@excalidraw/excalidraw/<subpath>` import anywhere in the package that touches Excalidraw | `packages/editor-adapter/src/no-internal-import.spec.ts:24` (`INTERNAL_IMPORT_PATTERN` regex) + `:33-37` (`it.each(files)('%s only imports the package root'...)`, `expect(match?.[0] ?? null).toBeNull()`) scanning every non-spec `.ts` file in the package — 8 tests, all pass. Note: `apps/web` does not yet render Excalidraw at all (no dependency, confirmed by `grep -rn "excalidraw" apps/web/package.json apps/web/src` → no matches) — the guardrail is proven at the one integration point that exists (the adapter package itself); full end-to-end UI integration is F1 scope | ✅ PASS (guardrail-level, consistent with F0 spike scope) |
| EXP-01: WHEN a user exports a diagram THEN system SHALL produce `.excalidraw`, SVG, PNG and PDF files rendered server-side | All four formats produced server-side via an export flow | `apps/server/src/modules/render/svg.ts` (`renderSceneToSvg` via `@excalidraw/utils`'s `exportToSvg`) + `apps/server/src/modules/render/png.ts` (`rasterizeSvgToPng` via `@resvg/resvg-js`); `apps/server/src/modules/render/render.spec.ts:10-22` — `expect(svg).toContain('Hello architecture canvas')` + width/height > 0; `render.spec.ts:24-32` — `expect(png.subarray(0,8)).toEqual(PNG_MAGIC_BYTES)`. **PDF and `.excalidraw` file export are entirely unbuilt**; there is no export route/flow, only the two lower-level rendering primitives. spec.md's own coverage note confirms intent: "spikes T10/T11 de-riscam [de-risk] EXP-01/EDT-01" — de-risking, not implementing | ⚠️ Partial — SVG+PNG rendering technically proven; PDF, `.excalidraw` export and the export flow itself have zero evidence |
| EDT-01: WHEN a diagram is opened THEN system SHALL bootstrap from the server the current snapshot, revision, referenced assets and permissions before enabling editing | Server-side bootstrap flow returning snapshot/revision/assets/permissions | No evidence — no server route, no persistence-backed bootstrap flow exists in F0 (backend has no diagram storage yet; `packages/database` schema exists but nothing serves it). T11's actual deliverable (`packages/test-fixtures/src/generateScene.spec.ts`, `docs/operations/benchmarks.md`) benchmarks local `computeDiff`/`serializeScene`/`parseScene` cost at 1k/5k elements, which is evidence toward the **Edge Case** "WHEN a scene reaches 5000 elements THEN keep pan/zoom usable and bootstrap p95 under 3 seconds" (`docs/operations/benchmarks.md:35-38` explicitly: "`parseScene` at 5k elements (16 ms mean) is a small fraction of that budget... The rest of the bootstrap path... is out of scope for this benchmark and unmeasured here" — the author's own caveat) — not toward the literal EDT-01 AC text | ❌ GAP against the literal AC — no evidence; partial evidence exists for the adjacent Edge Case only |

**Status**: ❌ Gaps present (1 GAP with zero evidence: FND-02; 1 GAP against literal AC text: EDT-01; 2 partial/spec-precision: FND-05, EXP-01; 1 not-executable-in-sandbox: FND-01; 2 clean PASS: FND-03, EDT-07)

---

## Discrimination Sensor

Isolated `git worktree add /tmp/f0-verify-scratch HEAD` (never `git stash`). Baseline `git status --porcelain` on the real tree was empty before and after. `pnpm install --frozen-lockfile` + `pnpm -w build` run inside the scratch worktree to materialize workspace `dist/` outputs before mutating.

| Mutation | File:line | Description | Killed? |
| --- | --- | --- | --- |
| 1 | `packages/editor-adapter/src/computeDiff.ts:50` | Flipped `prior.version !== element.version \|\| prior.versionNonce !== element.versionNonce` → `&&` (an element whose `version` OR `versionNonce` alone changes should still be detected as an upsert; the mutant only detects upserts when BOTH change) | ❌ **Survived** — `pnpm vitest run src/computeDiff.spec.ts` still reported 25/25 passing. Root cause: every parametrized fixture test that exercises the "existing element changed" branch (`computeDiff.spec.ts:79-101`) bumps `version` and `versionNonce` together (`version: target.version + 1, versionNonce: target.versionNonce + 1`); no test isolates a version-only or versionNonce-only change, despite the function's own docstring (`computeDiff.ts:15`) explicitly claiming "`version` **or** `versionNonce` differs → upsert" |
| 2 | `apps/server/src/core/config.ts:36` | Changed the insecure-default check `if (parsed[varName] === INSECURE_DEV_SECRET)` → `if (false && parsed[varName] === INSECURE_DEV_SECRET)` (never rejects) | ✅ Killed — `pnpm vitest run src/core/config.spec.ts` → 2 of 4 tests failed (`throws naming SESSION_SECRET...`, `throws naming ENCRYPTION_KEY...`), both `expected [Function] to throw an error` |
| 3 | `infra/migrations/0000_true_sharon_carter.sql:92` | `CREATE UNIQUE INDEX "workspaces_slug_unique"` → `CREATE INDEX` (drops the uniqueness constraint on `workspaces.slug`) | ✅ Killed — `pnpm vitest run -c vitest.integration.config.ts src/migrate.int.spec.ts` → 1 of 5 tests failed (`rejects a duplicate workspace slug via the unique constraint`, `expected undefined to be an instance of Error`) |

All three mutations were individually applied, run, and reverted (`git checkout -- <file>`) before the next was injected. After removing the scratch worktree (`git worktree remove --force /tmp/f0-verify-scratch`), the real tree's `git status --porcelain` was re-diffed against the pre-sensor baseline and found identical (empty both times).

**Sensor depth**: lightweight (3 targeted mutations, default tier — F0 is foundation/infra work, not P0 payment/auth)
**Result**: 2/3 killed, **1 survived** → ❌ **FAIL**

The surviving mutant is a genuine test-suite gap in T9's own Done-when: "computeDiff detecta upsert/delete/no-op corretamente nas fixtures (**todos os branches**)" — the OR-branch is not independently exercised. This alone is sufficient to fail the sensor gate per validate.md ("Surviving mutants → create fix tasks before marking the feature done").

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code | ✅ — each task's diff matches its stated scope |
| Surgical changes | ✅ |
| No scope creep | ⚠️ — T9's "What" describes `<EditorSurface/>` rendering `<Excalidraw/>` as a deliverable; no such component exists anywhere in the repo (`grep -rln "EditorSurface"` → no matches). The graded Done-when checklist for T9 never actually requires it, so this is a documentation/description overstatement, not an unauthorized code addition — flagged for tasks.md hygiene, not a functional gap |
| Matches patterns | ✅ — consistent Zod/Fastify/Drizzle/Vitest conventions across packages |
| Spec-anchored outcome check (asserted values match spec) | ⚠️ — see AC table; 2 clean, 1 sandbox-unexecutable, 4 with gaps/partial |
| Per-layer Coverage Expectation met (domain 1:1 ACs; routes happy+edge+error) | ⚠️ — computeDiff's OR/AND branch not independently covered (sensor mutation 1) |
| Every test maps to a spec requirement — no unclaimed tests | ✅ — spot-checked config.spec.ts, server.spec.ts, migrate.int.spec.ts, computeDiff.spec.ts, render.spec.ts, generateScene.spec.ts; every test traces to a Done-when line or spec AC via docstring/describe-block citation |
| Documented guidelines followed | `docs/product-spec.md` §17, `design.md` Test Strategy (per tasks.md Test Coverage Matrix header) — followed |

---

## Edge Cases

- [x] "WHEN a scene reaches 5000 elements THEN keep pan/zoom usable and bootstrap p95 under 3 seconds" — partially de-risked: `parseScene`/`serializeScene`/`computeDiff` costs at 5k elements are far under budget (16.14ms/12.69ms/1.13ms mean, `docs/operations/benchmarks.md:21-27`), but pan/zoom usability and the full bootstrap path (network, editor mount, initial render) are NOT measured — author's own caveat in `benchmarks.md:35-38`
- [ ] All other spec.md Edge Cases (SVG upload sanitization, zip bombs, WS ticket reuse, out-of-order ops, 256KB message limit, MinIO unavailability, AI token budget) — out of scope for F0, no F0 task claims them, correctly unaddressed

---

## Gate Check

- **Gate command**: `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration`
- **Result**: all 5 stages exit 0. Unit: 13 test files, 86 tests passed, 0 failed (shared-contracts 4 files/17 tests, server 3 files/18 tests, editor-adapter 5 files/43 tests, test-fixtures 1 file/8 tests). Integration: 1 test file, 5 tests passed, 0 failed (database). **91 tests total, 0 failed, 0 skipped**
- **Test count before feature**: 0 (greenfield repo, `e4aff3a` predates all test files)
- **Test count after feature**: 91
- **Delta**: +91 new tests
- **Skipped tests**: none
- **Failures**: none (gate check itself is clean; failures were only in the isolated sensor scratch worktree, always reverted)

---

## Fix Plans

### Fix 1: computeDiff OR/AND branch not independently tested (surviving mutant)

- **Root cause**: `computeDiff.spec.ts`'s "detects an upsert when version/versionNonce change" test (`computeDiff.spec.ts:79-101`) always bumps both `version` and `versionNonce` together, so the `||` in `computeDiff.ts:50` is behaviorally indistinguishable from `&&` under the current suite.
- **Fix task**: Add two cases per fixture (or a representative subset) to `computeDiff.spec.ts`: (a) only `version` changes, `versionNonce` unchanged → expect `upsert`; (b) only `versionNonce` changes, `version` unchanged → expect `upsert`. Both must independently fail against the `&&` mutant.
- **Priority**: Major (weak test on a domain-invariant branch condition; not a shipped defect, but the safety net for it doesn't exist yet)

### Fix 2: FND-02 (outbound internet blocked except AI base URL) has zero evidence

- **Root cause**: No compose-level network policy, firewall rule, or automated test enforces or checks this property. The AC is currently satisfied only by the absence of outbound calls in the current (AI-less) F0 codebase, which is not a durable guarantee once F2 lands the AI provider.
- **Fix task**: Either (a) add an automated check (e.g., an integration test using `docker network` isolation, or a static analysis pass banning non-allowlisted outbound hosts) before AUTH/AIC work lands in F1/F2, or (b) explicitly re-scope FND-02's enforcement to a later phase in spec.md if it's intentionally deferred, and note that in the Assumptions table.
- **Priority**: Minor for F0 (no AI integration exists yet to leak from) — escalates to Major once F2 lands.

### Fix 3: EXP-01 and EDT-01 traceability status should not advance to Verified

- **Root cause**: Both are spike/de-risking tasks (T10, T11) by the spec's own coverage note, not full implementations. EXP-01 lacks PDF/`.excalidraw` export and any export route; EDT-01 lacks any server-side bootstrap flow (no persistence-backed diagram-open API exists yet).
- **Fix task**: None needed now — this is expected given F0 is a foundation/spike wave. Re-verify EXP-01 and EDT-01 for real when F1 builds the actual export route and diagram-open/bootstrap flow.
- **Priority**: N/A (informational — traceability correctly stays `Implementing`, see below)

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| FND-01 | Implementing | Implementing *(unchanged — not executable in this sandbox; `docker compose up --build` end-to-end never ran, only `docker compose config` statically validated)* |
| FND-02 | Implementing | Implementing *(unchanged — zero evidence, see Fix 2)* |
| FND-03 | Implementing | ✅ Verified *(fully covered, sensor-confirmed)* |
| FND-05 | Implementing | Implementing *(unchanged — HTTP health/drain proven, but WS/jobs draining clause has no evidence since neither subsystem exists yet)* |
| EDT-07 | Implementing | ✅ Verified *(guardrail fully covered at the one integration point that exists in F0)* |
| EXP-01 | Implementing | Implementing *(unchanged — SVG/PNG spike proven, PDF/`.excalidraw`/export flow unbuilt, see Fix 3)* |
| EDT-01 | Implementing | Implementing *(unchanged — literal AC has zero evidence; only the adjacent Edge Case is partially de-risked, see Fix 3)* |

Only FND-03 and EDT-07 move to ✅ Verified — every other requirement in this wave's claimed set has a real, evidence-backed gap and correctly stays `Implementing`.

---

## Summary

**Overall**: ❌ Not Ready

**Spec-anchored check**: 2/7 ACs fully matched spec outcome (FND-03, EDT-07); 5/7 have a real or spec-precision gap (FND-01 sandbox-unexecutable, FND-02 zero evidence, FND-05 partial, EXP-01 partial, EDT-01 zero evidence against literal text)

**Sensor**: 2/3 mutations killed, 1 survived (`computeDiff.ts:50` OR/AND branch)

**Gate**: 5/5 stages passed (lint, typecheck, build, test:unit, test:integration), 91/91 tests passed, 0 failed

**What works**: The build-level gate is fully clean across all 6 packages/apps. `loadConfig`'s insecure-default rejection (FND-03) and the editor-adapter's no-internal-import guardrail (EDT-07) are both cleanly implemented and test-proven, confirmed independently by this Verifier including via the discrimination sensor. Database constraints (FK, unique slug, soft-delete) are real and integration-tested against a genuine Postgres engine (PGlite). The compose stack's static schema is valid (`docker compose config` independently re-run, exit 0) and the Dockerfile build chain was manually dry-run and caught a real bug (`tsconfig.base.json` not copied by `turbo prune --docker`). The batch workers' documentation of sandbox limitations (no Docker daemon, no GitHub Actions) is honest and consistent with what this Verifier independently reconfirmed.

**Issues found**:
1. `computeDiff`'s OR/AND branch condition is not independently tested — a real regression here (only one of `version`/`versionNonce` changing) would ship silently. Fix: add the two missing test cases (see Fix 1).
2. FND-02 (outbound internet blocked except AI base URL) has no automated enforcement or test anywhere in the diff surface. Fix: add a check before F2's AI integration lands, or explicitly defer in spec.md (see Fix 2).
3. EXP-01 and EDT-01 traceability entries should not be read as "the export flow" or "the bootstrap flow" being done — they are spike-level de-risking only, correctly left `Implementing` (see Fix 3, informational).

**Next steps**: Route Fix 1 (test-suite gap) and Fix 2 (FND-02 evidence) as fix tasks to an implementer; re-dispatch the Verifier after both land. EXP-01/EDT-01 require no fix task now — they are correctly scoped as spikes and will be re-verified for real when F1 builds the actual export route and diagram-bootstrap flow. This is fix→re-verify iteration 1 of the 3-iteration bound.
