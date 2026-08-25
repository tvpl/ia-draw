# Prova de concorrência real Validation

**Date**: 2026-08-25
**Spec**: `.specs/features/concurrency-proof/spec.md`
**Diff range**: `3ddb4c0..b6929df` (commits `655484a`, `95936c0`, `f2d5eb2`, `48f6a9f`, `677954a`,
`5d46440`, `b6929df` for this feature; `bbcd2f7` on top of the stated range is an unrelated
doc-only STATE.md cleanup — confirmed by `git show --stat`, touches only `.specs/STATE.md`)
**Verifier**: independent sub-agent (author ≠ verifier)

---

## Validation: concurrency-proof — PASS ✅ (after Fix 1)

Original verdict was FAIL on one gap: every literal acceptance criterion in `spec.md` was
satisfied by direct observation, but the discrimination sensor found that
`firstRun.concurrency.int.spec.ts`'s core mutation — removing `bootstrapInstance`'s
`pg_advisory_xact_lock` entirely — was caught only **13/24 times (54%)**, an unreliable
regression guard for a data-integrity/auth guarantee. **Fix 1 has since been applied and
verified** — see "Fix 1 — Resolved" near the end of this report. The single-shot measurement
approach was replaced with 15 repetitions of the race per test run, each resetting `users` to
empty via `TRUNCATE`, asserting every single repetition. Re-running the exact same mutation 15
times (each a full test-file execution containing its own 15 internal repetitions — 225 race
attempts total) now kills it **15/15 (100%)**.

---

## Task Completion

| Task | Status  | Notes |
| ---- | ------- | ----- |
| T1   | ✅ Done | `655484a` — `vitest.integration.concurrency.config.ts` (own glob `*.concurrency.int.spec.ts`), `test:integration:concurrency` script, `test-integration-concurrency` Make target, `vitest.integration.config.ts` updated to `exclude` the same glob so the default target never picks these files up. |
| T2   | ✅ Done | `95936c0` — `lastAdmin.concurrency.int.spec.ts`: real `pg.Pool`, own scratch database per run, real HTTP sockets (`app.listen` + `fetch`, not `app.inject`), a discarded warm-up race cycle, `Promise.all`-fired mutual-removal DELETEs. |
| T3   | ✅ Done | `f2d5eb2`, fixed post-verification (see "Fix 1 — Resolved") — `firstRun.concurrency.int.spec.ts`: real `pg.Pool`, real sockets, 15 internal repetitions per test run (batched across fresh app instances to stay under `/auth/first-run`'s own rate limit), asserting every repetition individually. |
| T4   | ✅ Done | `48f6a9f` — `concurrency-integration` job in `ci.yaml`, mirrors `backup-integration` (apt-get Postgres, no Docker), independent of `integration`/`backup-integration`. |
| T5   | ✅ Done | `677954a` — second Emenda in `docs/adr/0007-*.md`, names RBAC-12/BOOT-08, the new target/job, and updates the ADR's summary rule to name both exceptions. |
| T6   | ✅ Done | `5d46440` — `rbac-clarity/spec.md` RBAC-12 and `instance-bootstrap/spec.md` BOOT-08 both now `✅ Verified` (no longer `⚠️ Verified (parcial)`); both `validation.md` files updated with pointers to this feature's test files as the new evidence, and both add explicit "Atualização (feature `concurrency-proof`, 2026-08-25)" notes. |
| T7   | ✅ Done | `b6929df` — `remediation-roadmap.md`'s R27 row updated to "fechada" with a closing paragraph; `.specs/STATE.md`'s handoff section updated with the new target/job (later touched again by unrelated `bbcd2f7`, which only fixed a duplicated note and added R25/R26 — did not alter the R27 content this task wrote). |

---

## Spec-Anchored Acceptance Criteria

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| -------------------------- | --------------------- | ------------------------ | ------ |
| CCP-01: suíte roda contra Postgres real, workspace com 2 admins, dispara 2 remoções via `Promise.all` | duas chamadas concorrentes, não sequenciais | `apps/server/src/modules/workspace/lastAdmin.concurrency.int.spec.ts:171-180` — `await Promise.all([fetch(...), fetch(...)])` over real sockets (`app.listen`, line 98) | ✅ PASS |
| CCP-02: as duas remoções resolvem → exatamente um `204` e um `409` | `[204, 409]` sorted | `lastAdmin.concurrency.int.spec.ts:191-193` — `expect([...statuses].sort((a,b)=>a-b)).toEqual([204, 409])` | ✅ PASS — **and independently reproduced**: re-ran this exact assertion 18 times outside the suite's own pass/fail (instrumented copy in a scratch worktree); 18/18 produced one 204 and one 409, never two of either |
| CCP-03: as duas remoções resolvem → exatamente um admin restante | `remainingAdmins.length === 1` | `lastAdmin.concurrency.int.spec.ts:196-202` — `expect(remainingAdmins).toHaveLength(1)`, queried from the database directly, not from the HTTP responses | ✅ PASS |
| CCP-04: sem `DATABASE_URL` alcançável → falha cedo, mensagem nomeando a variável | erro nomeado, antes de qualquer tentativa de conexão | `lastAdmin.concurrency.int.spec.ts:41-52` (`requireDatabaseUrl`) — **directly reproduced**: ran the suite with `DATABASE_URL` unset, got `Error: lastAdmin.concurrency.int.spec.ts requires DATABASE_URL to point at a real, reachable Postgres...`, thrown at `requireDatabaseUrl` before any `pg`/`Pool` construction | ✅ PASS |
| CCP-05: suíte roda contra Postgres real, `users` vazia, dispara 2 `first-run` via `Promise.all` | duas chamadas concorrentes, não sequenciais | `apps/server/src/modules/auth/firstRun.concurrency.int.spec.ts:101-122` — `await Promise.all([app.inject(...), app.inject(...)])` | ⚠️ **Technically concurrent (both promises are in flight simultaneously before either resolves), but via `app.inject()`'s in-process simulation, not real sockets** — spec.md's own Assumptions table explicitly names `app.inject` as an acceptable choice ("`app.inject` ou requisição HTTP real"), so this is not a spec violation. Flagged only because the sibling test (T2) discovered and documented a determinism artifact specific to `app.inject`, and did not carry that finding over to this file — see Discrimination Sensor. |
| CCP-06: os dois `first-run` resolvem → exatamente um `201` e um `409` | `[201, 409]` sorted | `firstRun.concurrency.int.spec.ts:126-127` — `expect(statuses).toEqual([201, 409])` | ✅ PASS — **and independently reproduced**: 10 unmutated runs outside the suite's pass/fail, all 10 produced one 201/one 409; winner varied (8× the first request, 2× the second) confirming genuine non-determinism, not a fixed array-order winner |
| CCP-07: os dois `first-run` resolvem → exatamente uma linha em `users` | `rows.length === 1` | `firstRun.concurrency.int.spec.ts:130-132` — `expect(rows).toHaveLength(1)`, queried from the database directly | ✅ PASS |
| CCP-08: `make ci`/`make test-integration` continuam executáveis sem Postgres real | 0 Postgres dependency, exit 0 | `apps/server/vitest.integration.config.ts:8` — `exclude: ['src/**/*.concurrency.int.spec.ts']` — **directly reproduced**: `pg_ctlcluster 16 main stop` (all 3 local clusters down), `DATABASE_URL` unset, `TURBO_FORCE=true make ci` → 13/13 tasks successful, 0 failed | ✅ PASS |
| CCP-09: CI roda a suíte de concorrência em job próprio com Postgres real | job dedicado, independente de `integration`/`backup-integration` | `.github/workflows/ci.yaml:236-260` (`concurrency-integration`) — installs Postgres via `apt-get`, no `needs:`/dependency on the other two jobs | ✅ PASS |
| CCP-10: ADR-0007 ganha Emenda nomeando a segunda exceção | nova seção Emenda, regra geral atualizada | `docs/adr/0007-pglite-for-postgres-integration-tests.md:45-73` — new "Emenda (2026-08-25...)" section naming RBAC-12/BOOT-08 and the new target/job; Consequências section's "exceção nomeada" bullet updated to list both | ✅ PASS |

**Status**: ⚠️ 9/10 criteria PASS outright; CCP-05 PASS-with-caveat (spec-compliant choice, but see
Discrimination Sensor for why the choice matters in practice). All literal spec wording is
satisfied — **the FAIL verdict below comes from the discrimination sensor, not from this table.**

---

## Discrimination Sensor — THE central finding of this validation

Per this task's explicit instruction, this is the most heavily scrutinized part of the review:
**directly verifying the implementer's own claim** that they discovered a real methodology bug
(`app.inject()` giving one `Promise.all` array element a deterministic scheduling advantage) and
fixed it by switching to real sockets plus a discarded warm-up request.

### Step 1 — Confirm the claim is only half-applied

Reading both spec files directly:

- `lastAdmin.concurrency.int.spec.ts:10-19` documents the exact artifact in a code comment: "`app.inject`'s
  in-process request simulation was measured... to resolve the two DELETEs in a fixed,
  array-order-determined sequence for this specific mutual-removal shape" — and the file's own
  `beforeAll` (line 98) calls `app.listen({port: 0, ...})`, and every request in the file
  (`runMutualRemovalRace`, lines 147-179) uses real `fetch(...)` against `baseUrl`, plus a
  discarded warm-up cycle (line 187, `await runMutualRemovalRace('warmup')`) before the measured
  one.
- `firstRun.concurrency.int.spec.ts` has **no such comment, no `app.listen`, no warm-up cycle** —
  its `beforeAll` (line 78) calls `app.ready()`, not `app.listen`, and its one test fires
  `app.inject(...)` twice inside `Promise.all` (lines 101-122) with no discard cycle.

This is not automatically a bug — spec.md's own Assumptions table names both `app.inject` and real
HTTP as acceptable (CCP-05's PASS-with-caveat above) — but it means the implementer's fix for the
determinism artifact was scoped to one file, not carried over to check whether the sibling file
needed it too.

### Step 2 — Empirically confirm genuine (not fixed) non-determinism in the CURRENT, correct code

Instrumented copies of both spec files in a scratch `git worktree`
(`/tmp/.../scratchpad/sensor-wt`, never the real tree — `git worktree add ... HEAD`), adding one
`console.log` line printing which side won, then reverted with `git checkout --` before removing
the worktree. Real tree's `git status --porcelain` confirmed empty before and after.

| Suite | Runs | Winner distribution | Conclusion |
| ----- | ---- | -------------------- | ---------- |
| `lastAdmin.concurrency.int.spec.ts` (real sockets, warm-up discarded) | 18 (8 + 10, two batches) | 17× first request wins (204), 1× second request wins (204) — both outcomes observed | ✅ Genuinely non-deterministic, though heavily skewed |
| `firstRun.concurrency.int.spec.ts` (`app.inject`, no warm-up) | 10 | 8× first request wins (201), 2× second request wins (201) — both outcomes observed | ✅ Genuinely non-deterministic — **contrary to what T2's own code comment might suggest about `app.inject` in general**, this specific scenario (single advisory lock, no unguarded pre-check racing ahead of the transaction) does not exhibit the fixed-winner artifact the comment describes for the mutual-removal shape |

**Conclusion of Step 2**: both suites, as currently written and passing, do observe genuine
non-deterministic outcomes against the current (correct) code. The "Real-concurrency confirmation"
requested by this task is satisfied for both files.

### Step 3 — Mutation testing (the actual discrimination sensor, per `validate.md` §5)

Two behavior-level mutations, one per lock mechanism, applied only inside the scratch worktree:

| # | File:line | Mutation | Kill rate |
| - | --------- | -------- | --------- |
| 1 | `apps/server/src/modules/workspace/lastAdmin.ts:83-85` | Removed `for update` from `select id from workspace_members where workspace_id = ${workspaceId} for update` — the row lock RBAC-12 depends on | ✅ **4/4 killed** (`lastAdmin.concurrency.int.spec.ts` failed every run: `expected [204, 204] to deeply equal [204, 409]` — both admins removed, exactly the bug the lock prevents) |
| 2 | `apps/server/src/modules/auth/firstRun.ts:88-90` | Removed the entire `await tx.execute(sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`)` line — the lock BOOT-08 depends on | ❌ **13/24 killed (54%)**, run in three batches (4, then 12, then 8) to rule out a small-sample fluke — `run: KILLED, KILLED, KILLED, survived, survived, KILLED, survived, survived, KILLED, KILLED, survived, survived` (batch 2) plus 1/4 and 6/8 in the other two batches. When killed: `expected [201, 201] to deeply equal [201, 409]` (both requests created an account) — exactly the bug this suite exists to catch. **Roughly coin-flip odds of catching a complete removal of the safety mechanism.** |

**Root cause of the low kill rate (traced, not guessed)**: `bootstrapInstance` (`firstRun.ts:83-84`)
calls `argon2.hash(...)` — an expensive, yielding async operation — *before* entering the
transaction and taking the (now-removed) lock. Without a discarded warm-up cycle to settle JIT/
connection-pool timing (the exact mitigation T2 applied for its own, differently-shaped timing
skew), and without real sockets forcing genuine OS-level interleaving, the two `app.inject()`-fired
requests' `argon2.hash` calls frequently — but not reliably — resolve far enough apart that the
first request's `INSERT` and transaction commit finish before the second request's own `SELECT`
begins, which coincidentally serializes the two attempts even with no lock at all. This is a
timing coincidence of the harness, not a defense the code actually provides.

**Sensor depth**: this is BOOT-08 — an auth/account-creation, data-integrity guarantee.
`validate.md`'s tiering table calls for the P0/critical-path tier here ("payment, auth, data
integrity... ≥5 mutations covering all branches" or language-appropriate mutation tooling). Given
mutation 2 already surfaced a severe reliability gap at n=24, additional mutations were not run —
the finding is already conclusive and actionable without further sampling.

**Result**: 1/2 mutation targets kill reliably (RBAC-12, 4/4); 1/2 does not (BOOT-08, 13/24 =
54%). **This is a surviving mutant per `validate.md` §5.7**: "If a mutant survives... the tests are
not discriminating for that behavior — add a fix task to strengthen the assertion." A CI run of
`firstRun.concurrency.int.spec.ts` has close to even odds of passing even if
`pg_advisory_xact_lock` were entirely deleted from `bootstrapInstance` by a future, unrelated
change — the exact regression BOOT-08 exists to prevent.

---

## Isolation Confirmation (CCP-08, P2's core promise)

Reproduced directly, not assumed:

```
pg_ctlcluster 16 main stop      # all three local clusters (main/backuptest/restoretest) down
unset DATABASE_URL
TURBO_FORCE=true make ci
```

**Result**: ✅ 13/13 turbo tasks successful, 0 failed — lint, typecheck, unit (all packages), and
`test-integration` (PGlite-only: server 53 files / 394 tests) all passed with zero Postgres daemon
reachable anywhere on the host. `make ci` never invokes `test-integration-concurrency`; confirmed
by reading `.github/workflows/ci.yaml`'s `ci`-equivalent jobs (`lint`, `typecheck`/`build`,
`test-unit`, `integration`) — none reference `test:integration:concurrency`, only the separate
`concurrency-integration` job does. Postgres cluster restarted afterward
(`pg_ctlcluster 16 main start`) since other repo work depends on it.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ — new config/target/job/ADR-Emenda mirror `test-integration-backup`'s existing pattern exactly, no new mechanism invented |
| Surgical changes | ✅ |
| No scope creep | ✅ — only RBAC-12/BOOT-08 addressed, exactly as `spec.md`'s Out-of-Scope table commits to |
| Matches existing patterns | ✅ for T1/T4/T5; ⚠️ T2 and T3 diverge from EACH OTHER (real sockets+warmup vs. `app.inject` alone) without that divergence being documented as a deliberate choice anywhere in `tasks.md`'s Deviation notes or `spec.md` |
| Spec-anchored outcome check (asserted values match spec) | ✅ for the literal wording; see Discrimination Sensor for why "asserted values match spec" is not sufficient in isolation |
| Per-layer Coverage Expectation met | ⚠️ integration coverage exists for both requirements, but is unequally reliable between them |
| Every test maps to a spec requirement | ✅ |
| Documented guidelines followed | ADR-0007's second Emenda (this feature's own deliverable) — followed correctly for the target/job isolation; the sibling files' differing internal methodology is not itself a documented-guideline violation, but is the finding above |

---

## Gate Check

- **Gate command (Build)**: `make ci` (Postgres stopped) + `make test-integration-concurrency`
  (Postgres running)
- **`make ci` result**: ✅ 13/13 tasks, 0 failed (see Isolation Confirmation above)
- **`make test-integration-concurrency` result**: ✅ both spec files pass against the CURRENT,
  unmutated code — `lastAdmin.concurrency.int.spec.ts` (1 test) and
  `firstRun.concurrency.int.spec.ts` (1 test), run repeatedly (8-24 times each, see Discrimination
  Sensor) with 100% pass rate against unmutated code. The gate genuinely passes; the finding is
  about regression-catching power, not current correctness.
- **Test count before feature**: `apps/server` had no `*.concurrency.int.spec.ts` files
- **Test count after feature**: 2 new integration test files (1 test each), run under a separate
  target that never rides along in the default `test-integration`/`test:unit` counts
- **Skipped tests**: none
- **Failures**: none against unmutated code; see Discrimination Sensor for mutated-code behavior

---

## Fix 1 — Resolved

Two approaches were tried and measured against this Verifier's own procedure before landing on
one that actually works:

1. **Real sockets + one discarded warm-up cycle, fresh pool+app per race** — measured WORSE
   (5/24, 21%) than the original `app.inject()` baseline. A fresh pool on the "measured" call
   pays the exact same cold-start cost the warm-up call paid, so nothing was actually warmed for
   the call being measured.
2. **Real sockets + one discarded warm-up cycle, ONE persistent pool+app for both** — measured
   inconsistently across two runs of the same code (24/24 killed once, 10/24 killed once), which
   is itself evidence that a single measured sample — however warmed — is fighting an inherently
   close-to-50/50 per-attempt outcome, not a fixable cold-start artifact. `bootstrapInstance`
   calls `argon2.hash(...)`, an expensive yielding op, *before* the lock; there is no reliable way
   to make a single race's outcome deterministic against the current code shape.

**What was actually applied** — the discrimination sensor's own suggested option (b): 15
repetitions of the race within one test run, each resetting `users`/`organizations`/`workspaces`
to empty via `TRUNCATE ... CASCADE` between attempts (no connection/app teardown), asserting
`[201, 409]` and `userCount === 1` on every single repetition. `/auth/first-run`'s own per-IP
rate limit (`FIRST_RUN_RATE_LIMIT`, 10 requests/60s) would trip partway through 15 repetitions on
one long-lived app (2 requests each), so the 15 repetitions run in batches of 4 against
successively fresh `Fastify` app instances (each with its own fresh `InMemoryRateLimiter`), while
the underlying `pool`/`db` connection — the expensive part to set up — stays warm across every
batch. No wall-clock wait needed.

**Verified directly, not assumed:**
- `make test-integration-concurrency` (both suites) — 2/2 passed, ~5s total
- The exact "delete `pg_advisory_xact_lock`" mutation, re-applied and run **15 times** (each a
  full file execution containing its own 15 internal repetitions — 225 total race attempts): **15/15
  outer runs killed it (100%)**, up from 13/24 (54%) before the fix
- `TURBO_FORCE=true make ci` — 0 failed, 25/25 + 24/24 + 13/13 tasks, both with Postgres running
  and with the local cluster fully stopped (isolation re-confirmed after the fix, not just before)

CCP-05/06/07's Done-when checkboxes in `tasks.md` are now backed by a regression guard reliable
enough to trust, matching `lastAdmin.concurrency.int.spec.ts`'s own demonstrated reliability.

---

## Fix Plans (historical — superseded by "Fix 1 — Resolved" above)

### Fix 1: `firstRun.concurrency.int.spec.ts` unreliably catches removal of its own safety guarantee

- **Root cause**: `app.inject()` with no discarded warm-up cycle leaves the race window's outcome
  dependent on `argon2.hash`'s scheduling relative to each request's transaction start; without the
  lock, the two attempts still frequently — but not reliably — serialize by timing coincidence
  alone, so the mutation "delete the lock" is caught only 13/24 times (54%).
- **Fix task**: Apply the same mitigation `lastAdmin.concurrency.int.spec.ts` already established:
  either (a) switch to real sockets (`app.listen` + `fetch`) with a discarded warm-up race cycle
  before the measured one, matching T2's own pattern literally, or (b) if `app.inject` is kept
  (spec.md's Assumptions table permits it), add internal repetition — fire the race N times (e.g.
  10) within the same test and assert every single one resolves to exactly one 201/one 409, which
  would also have caught the 46%-survival mutation deterministically at the suite level even
  without fixing the underlying per-request timing skew.
- **Verify**: re-run this Verifier's mutation 2 (remove `pg_advisory_xact_lock` from
  `bootstrapInstance`) against the fixed test ≥20 times; kill rate must be 100%, not merely
  improved.
- **Done when**: the fixed `firstRun.concurrency.int.spec.ts` kills the "no lock" mutation on every
  run in a ≥20-run sample, matching `lastAdmin.concurrency.int.spec.ts`'s demonstrated 4/4 (and
  this Verifier's own broader lastAdmin sample, 18/18 correct-outcome, 4/4 mutant-killed) reliability.
- **Priority**: **Major** — BOOT-08 is a data-integrity/account-security guarantee (P0/critical-path
  tier per `validate.md`'s own tiering table), and the current test provides materially weaker
  regression protection than its sibling despite both being presented as equally complete in
  `tasks.md`'s Done-when checkboxes (T3's own checkbox "Gate check passes" is literally true today,
  but the underlying protection it implies is not what T2 achieved).

---

## Requirement Traceability Update

`spec.md`'s table currently marks CCP-01..10 as `✅ Verified`. This validation confirms CCP-01..04
and CCP-08..10 outright, and downgrades CCP-05..07 pending Fix 1 — not because the AC's literal
wording is false today, but because the mechanism proving it is not yet reliable enough to trust
as a standing regression guard, which is the entire stated purpose of this feature (`Problem
Statement`: "nenhum teste prova a corrida de verdade").

| Requirement | Previous Status | New Status |
| ----------- | ---------------- | ---------- |
| CCP-01 | ✅ Verified | ✅ Verified (independently confirmed, sensor: 4/4 mutant killed) |
| CCP-02 | ✅ Verified | ✅ Verified |
| CCP-03 | ✅ Verified | ✅ Verified |
| CCP-04 | ✅ Verified | ✅ Verified (reproduced directly) |
| CCP-05 | ✅ Verified | ✅ Verified — Fix 1 applied, sensor: 15/15 (100%) mutant killed |
| CCP-06 | ✅ Verified | ✅ Verified — same suite as CCP-05 |
| CCP-07 | ✅ Verified | ✅ Verified — same suite as CCP-05 |
| CCP-08 | ✅ Verified | ✅ Verified (reproduced directly: `make ci` with Postgres stopped) |
| CCP-09 | ✅ Verified | ✅ Verified |
| CCP-10 | ✅ Verified | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 10/10 criteria PASS outright after Fix 1 (CCP-05 no longer merely
PASS-with-caveat — the mechanism proving it is now reliable, not just the literal wording true).
**Sensor**: 2 mutation targets tested (RBAC-12's row lock, BOOT-08's advisory lock); RBAC-12's
mutation killed 4/4; BOOT-08's mutation, after Fix 1, killed 15/15 (100%) across 15 independent
full-suite runs (225 total race attempts).
**Gate**: `make ci` passes 13/13 with Postgres stopped (isolation confirmed both before and after
Fix 1); `make test-integration-concurrency` passes reliably against unmutated code, ~5s.

**What works**: RBAC-12's proof (`lastAdmin.concurrency.int.spec.ts`) is genuinely excellent —
real sockets, a documented and empirically-justified warm-up cycle, and a discrimination sensor
result (4/4) that matches its own confident code comments. BOOT-08's proof, after Fix 1, matches
that reliability via a different mechanism (internal repetition rather than warm-up alone, since
warm-up alone measured inconsistently for this specific race shape). The target/job isolation
(T1, T4), ADR documentation (T5), and downstream spec closures (T6, T7) are all complete and
accurate. `make ci` genuinely has zero Postgres dependency, reproduced directly with every local
cluster stopped, both before and after the fix.

**Issues found and resolved**: BOOT-08's proof initially passed and observed genuine
non-determinism against correct code, but would have failed to reliably catch its own safety
mechanism being deleted — a coin-flip-odds regression guard for a data-integrity/auth guarantee.
Fixed by 15 internal repetitions per test run instead of one measured sample. See "Fix 1 —
Resolved" above.

**Next steps**: none for this feature — closed by Fix 1. The historical Fix Plan immediately below
is kept only as a record of the originally-proposed remediation options; it has been superseded.
