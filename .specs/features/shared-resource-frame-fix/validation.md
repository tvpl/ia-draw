# Bug real de navegação entre frames Validation

**Date**: 2026-08-25
**Spec**: `.specs/features/shared-resource-frame-fix/spec.md`
**Diff range**: `e261446..e2de877` (commits 09bc474, 1abb4a2, 26fcaab, 2e51067 for this feature)
**Verifier**: independent sub-agent (author ≠ verifier)

## Validation: shared-resource-frame-fix - PASS ✅ (after Fix 1)

Original verdict was FAIL solely on the Gate-execution gap below (T3's own Build-gate command
did not pass). T1/T2/T4 were independently correct and verified from the start — see per-task
and per-AC evidence throughout this report. **Fix 1 has since been applied and verified** — see
the "Fix 1 — Resolved" section near the end of this report. All four tasks are now genuinely
complete, including a passing execution of SRF-04's own documented gate command.

---

## Task Completion

| Task | Status  | Notes |
| ---- | ------- | ----- |
| T1   | ✅ Done | `09bc474` — `key={frame.id}` added to `<EditorSurface>` in `SharedResourcePage.tsx`'s `presentation` branch; the plain shared-diagram branch keeps no `key`. |
| T2   | ✅ Done | `1abb4a2` — `EditorSurface.tsx`'s `initialData` comment rewritten to state the mount-only contract; `EditorSurface.spec.tsx`'s ESTB-04 test rewritten to prove only what the mock can prove. |
| T3   | ✅ Done | `26fcaab` — e2e test written and structurally sound. Its Build-gate command initially failed for a reason external to the test itself (see Gate-execution gap below); fixed post-verification — see "Fix 1 — Resolved". |
| T4   | ✅ Done | `2e51067` — `remediation-roadmap.md` and `.specs/STATE.md` updated; the SharedResourcePage frame-nav item is closed, and the newly-discovered `/share` routing debt is logged as open, undirected, and out of scope, matching what T3's own Deviation note says. |

---

## Spec-Anchored Acceptance Criteria

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| -------------------------- | --------------------- | ------------------------ | ------ |
| SRF-01: navegar entre frames remonta a superfície do canvas, refletindo os elementos do frame de destino | uma instância de `EditorSurface` diferente por frame (unmount real do frame anterior, mount real do novo) | `apps/web/src/share/SharedResourcePage.spec.tsx:323-341` — `expect(unmountedInstanceIds).toEqual([firstInstanceId]); expect(mountedInstanceIds).toHaveLength(2); expect(mountedInstanceIds[1]).not.toBe(firstInstanceId)` (mount/unmount tracked via a real `useEffect` cleanup on the mocked `<Excalidraw/>`, not a prop capture) | ✅ PASS |
| SRF-02: nenhum consumidor pode depender só da troca de prop — quem precisa de cena nova após o mount força remount via `key` estável | `EditorSurface`'s comment names the real mechanism; the rewritten ESTB-04 test asserts only what the mock proves, never that the real component reacts to the prop | `packages/editor-adapter/src/EditorSurface.tsx:219-225` (comment); `packages/editor-adapter/src/EditorSurface.spec.tsx:254-274` — assertion is `capturedInitialData).not.toBe(...)`/`toEqual({elements: frameB})` on the MOCK only, with an explicit comment disclaiming any claim about the real component | ✅ PASS |
| SRF-03: apresentação de um único frame monta o canvas uma vez, sem remount adicional | `mountedInstanceIds` length 1, `unmountedInstanceIds` length 0 | `apps/web/src/share/SharedResourcePage.spec.tsx:355-382` — `expect(mountedInstanceIds).toHaveLength(1); expect(unmountedInstanceIds).toHaveLength(0)` | ✅ PASS |
| SRF-04: um teste contra o `<Excalidraw/>` real (não mockado) mostra elementos diferentes por frame | canvas pixels change color (red↔blue) between frames, proven against the real, unmocked component | `apps/web/e2e/shared-presentation.spec.ts:127-256` — `expect.poll(() => canvasHasColor(...)).toBe(true)`/`expect(await canvasHasColor(...)).toBe(false)` for both colors, both directions of navigation | ⚠️ **Written correctly, but does not execute successfully** — see Gate Check. The assertions are spec-anchored and would prove SRF-04 if the test could run to completion; it cannot, in this repo's own `test:e2e` gate command, because setup fails before reaching the canvas at all. |
| Edge case: link de navegação do protótipo fora de ordem remonta do mesmo jeito | mesma troca de instância que a navegação linear | `apps/web/src/share/SharedResourcePage.spec.tsx:343-353` — `expect(unmountedInstanceIds).toEqual([firstInstanceId]); expect(mountedInstanceIds).toHaveLength(2)` | ✅ PASS |
| Edge case: apresentação de um frame não remonta | ver SRF-03 acima (mesmo teste) | `apps/web/src/share/SharedResourcePage.spec.tsx:355-382` | ✅ PASS |

**Status**: ❌ Gap present on SRF-04's execution (the AC's own logic and assertions are correct; the harness that is supposed to run it against a cold `make ci`/`make test-e2e`-equivalent environment cannot reach the assertions).

---

## Spec-precision note: the `/share` cold-navigation workaround (not a finding against the code)

The implementer's summary claims `page.goto('/share/:token')` never reaches the SPA — both the Vite dev proxy and Caddy forward the *entire* `/share*` prefix to `apps/server` unconditionally, with no distinction between a browser navigation and an XHR, so a real cold visit returns raw JSON. **Independently confirmed, not merely reproduced from the implementer's word:**

- `packages/shared-contracts/src/routePrefixes.ts` lists `/share` in `SERVER_ROUTE_PREFIXES`, the single source both edges consume/mirror (AD-013).
- `apps/web/vite.config.ts` maps every prefix in that list, including `/share`, to `API_PROXY_TARGET` with no path-based exception for navigation requests.
- `infra/compose/Caddyfile` has `handle /share* { reverse_proxy server:3000 }`, same unconditional forward.
- `apps/web/playwright.config.ts`'s `webServer` runs `pnpm dev` (the real Vite dev server with that exact proxy config) for the e2e suite — so the claim holds for the actual test harness, not just for `make up`'s Docker/Caddy stack.

This is a genuine, separate, pre-existing routing defect, correctly logged as new open debt in `remediation-roadmap.md` and `.specs/STATE.md` ("Aberto e sem dono"), not silently worked around. The test's actual workaround — load the SPA shell from `/login` (a path the edge does not own), then drive `history.pushState`/`popstate` to `/share/:token` client-side — still exercises the real, unmocked `<EditorSurface>`/`<Excalidraw/>` tree and the real `fetch('/share/:token')` XHR (which correctly *should* hit the backend). It proves exactly the defect SRF-04 is about — content not updating after mount, provable via internal navigation — and does not silently avoid testing a materially different code path for that specific defect. **This part of the implementer's account is accurate and the workaround is legitimate**, independent of the separate, more serious gate-execution problem below.

---

## Gate-execution gap (the actual finding)

Independently of the `/share` cold-navigation issue above (which the test correctly routes around), the e2e test **fails to execute past its own setup step**, for a different and undocumented reason: `POST /presentations/:id:publish` requires a live object-storage backend.

**Reproduced directly, twice:**

1. Ran `pnpm --filter @arch-canvas/web exec playwright test e2e/shared-presentation.spec.ts` (== `make test-e2e` == the exact Build-gate command T3 lists, == CI's `e2e` job command) in this sandbox: fails at `expect(publish.ok()).toBe(true)` (`apps/web/e2e/shared-presentation.spec.ts:194`) before any canvas assertion runs.
2. Isolated the cause with a standalone script replicating the same HTTP sequence against the same `vite-node`-run `apps/server` instance: the publish call returns `500 {"title":"connect ECONNREFUSED 127.0.0.1:9000"}`.

**Root cause, traced through the code, not inferred:**
- `publishPresentation` (`apps/server/src/modules/presentation/publish.ts:31-49`) calls `createSnapshot(db, storage, ...)`, which uploads to the real `StorageClient`.
- `apps/server/src/core/registerModules.ts:116-117` wires `deps.storage ?? createStorageClient(createS3Client(config))` — a real `S3Client` unless a test double is injected.
- `apps/web/e2e/support/runTestServer.ts` calls `registerAllModules(app, db, config)` with **no** `deps.storage` override — so the real client is built.
- `apps/server/src/core/config.ts:27` defaults `S3_ENDPOINT` to `http://localhost:9000`, and nothing in `runTestServer.ts`, `playwright.config.ts`, or the CI `e2e` job (`.github/workflows/ci.yaml:236-286`) sets that env var or starts MinIO. Only the separate `compose-smoke` and `backup-restore-drill` jobs bring up `minio` (confirmed by reading the full `ci.yaml`, not by inference from job names).
- `grep` across `apps/web/e2e/*.spec.ts` confirms this is the **first** e2e spec that calls a presentation-publish endpoint — there is no prior working precedent this test could have leaned on. Server-side `int.spec.ts` files that touch storage use a `FakeStorage`/`Fake*` double (confirmed present in `presentation/publish.int.spec.ts`, `snapshot/snapshot.int.spec.ts`, etc.) — a pattern that exists for Vitest integration tests, not for the real `buildServer` instance the Playwright harness boots.

**Consequence**: SRF-04's Done-when box in `tasks.md` ("Gate check passes: `pnpm --filter @arch-canvas/web run test:e2e`") is marked `[x]` but is not actually true in a clean checkout — the same command fails identically whether run here or (by code inspection of the workflow) in GitHub Actions' `e2e` job. This was very likely a local-environment artifact for the implementer (a MinIO instance left running from an earlier `make up`), not a fabrication — but it means the load-bearing SRF-04 proof has never actually been demonstrated passing in the environment the task itself specifies.

This is **not** the same issue as the `/share` cold-navigation deviation, which the implementer named and logged. This MinIO dependency was not named anywhere in `tasks.md`'s Deviation note, `remediation-roadmap.md`, or `.specs/STATE.md`.

---

## Discrimination Sensor

Isolated in a temporary `git worktree` (`git worktree add`), never `git stash`. Baseline `git status --porcelain` on the real tree was empty before sensor work and confirmed empty again after `git worktree remove --force` — real tree untouched throughout.

| # | File:line | Mutation | Killed? |
| - | --------- | -------- | ------- |
| 1 | `apps/web/src/share/SharedResourcePage.tsx:95` | Removed `key={frame.id}` from `<EditorSurface>` (the exact fix T1 introduced) | ✅ Killed — `SharedResourcePage.spec.tsx`'s two new SRF-01/02 tests both failed (`expected [] to deeply equal [ 1 ]`, i.e. the second instance never mounted/first never unmounted) |

**Sensor depth**: lightweight (1 targeted mutation — the single load-bearing behavior change of this feature; T2 is a comment/test-only change with nothing left to mutate, and T3's e2e mutation was not run given the e2e test cannot execute at all in this environment, which is already the primary finding)
**Result**: 1/1 killed — the unit-level tests genuinely discriminate the bug this feature fixes, independent of the e2e gate-execution gap above.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ — a `key` prop and a comment/test rewrite for T1/T2; T3 is additive (new file) |
| Surgical changes | ✅ |
| No scope creep | ✅ — `/share` routing debt was found, not fixed, and correctly deferred |
| Matches existing patterns | ✅ |
| Spec-anchored outcome check (asserted values match spec) | ✅ for SRF-01/02/03 + edge cases; ⚠️ for SRF-04 (assertions are correct, execution is not verified) |
| Per-layer Coverage Expectation met | ✅ unit: real lifecycle (mount/unmount identity), not prop capture — a stronger signal than a typical shallow "prop changed" assertion |
| Every test maps to a spec requirement | ✅ — every new test is labelled with its SRF-NN/edge-case tag |
| Documented guidelines followed | AD-007 (PGlite for integration, storage/asset reserved for CI) — the e2e gap above is exactly this documented seam, not touched by this feature but hit by its new test |

---

## Edge Cases

- [x] Apresentação de um frame: monta uma vez, sem remount (`SharedResourcePage.spec.tsx:355-382`)
- [x] Link de navegação fora de ordem: remonta do mesmo jeito que navegação linear (`SharedResourcePage.spec.tsx:343-353`)

---

## Gate Check

- **Gate command (Build)**: `make ci`
- **Result**: `make ci` (lint + typecheck + unit + integration) — ✅ 0 failed. Lint: 646 files, 0 issues. Typecheck: 25/25 tasks. Unit: all packages green, `@arch-canvas/web` 100 files / 962 tests (was 951 pre-`ui-foundations` baseline; SRF + EPC together add the delta). Integration: server 394/394, database 36/36.
- **Gate command (T3-specific, Build)**: `pnpm --filter @arch-canvas/web run test:e2e` (== `make test-e2e`) — originally ❌ 1 failed (`shared-presentation.spec.ts`), root cause above (MinIO not provisioned by this command or by CI's `e2e` job). **Now ✅ 3/3 passed after Fix 1** (`apps/web/e2e/support/fakeStorage.ts` + `registerAllModules(..., { storage })`).
- **Test count before feature**: `apps/web` unit 951 (per `ui-foundations/validation.md`)
- **Test count after feature**: `apps/web` unit 962 (net +11 across SRF's 2 new + rewritten ESTB-04 count change, and EPC's new tests below)
- **Skipped tests**: none
- **Failures**: none remaining. `apps/web/e2e/shared-presentation.spec.ts`'s original failure (`expect(publish.ok()).toBe(true)`, `500 ECONNREFUSED 127.0.0.1:9000`) is resolved — see "Fix 1 — Resolved".

---

## Fix 1 — Resolved

Applied the option (a) this report recommended: `apps/web/e2e/support/fakeStorage.ts` (new) is
the exact `putSignedUrl`/`getSignedUrl`/`headObject`/`putObject`/`getObject` in-memory double
already established by `apps/server/src/modules/presentation/publish.int.spec.ts`'s
`createFakeStorage`, reused verbatim rather than reinvented, wired into
`registerAllModules(app, db, config, { storage: createFakeStorage() })` in
`runTestServer.ts` — the exact injection seam `ModuleDependencies.storage` already exists for
(`apps/server/src/core/registerModules.ts:82-89`), confirming this Verifier's root-cause trace
was correct and the fix needed no new mechanism, only using the one already there.

**Verified directly, not assumed:**
- `pnpm --filter @arch-canvas/web exec playwright test e2e/shared-presentation.spec.ts` — 1 passed
- `pnpm --filter @arch-canvas/web exec playwright test` (all 3 e2e specs) — 3 passed, including
  `editor-console.spec.ts` and `crash-recovery.spec.ts` (confirms the fake storage double did not
  regress any route those specs touch)
- `TURBO_FORCE=true make ci` — 0 failed, 25/25 + 24/24 + 13/13 tasks, zero cache hits

SRF-04's Done-when checkbox in `tasks.md` is now genuinely true — `pnpm --filter @arch-canvas/web
run test:e2e` passes in a clean run, not by environmental accident.

---

## Fix Plans (historical — superseded by "Fix 1 — Resolved" above)

### Fix 1: SRF-04's e2e proof cannot execute in its own gate command

- **Root cause**: `publishPresentation` requires a real S3/MinIO endpoint (`config.s3.endpoint`, default `http://localhost:9000`); `apps/web/e2e/support/runTestServer.ts` boots the real `buildServer`/`registerAllModules` with no storage double, and neither `playwright.config.ts`'s `webServer` nor the CI `e2e` job (`.github/workflows/ci.yaml`) starts MinIO or points `S3_ENDPOINT` elsewhere. This is the first Playwright e2e spec to touch presentation publish, so no prior test caught this.
- **Fix task**: Either (a) inject a fake/in-memory `StorageClient` into `runTestServer.ts` the same way server-side `int.spec.ts` files already do (reuse the existing `FakeStorage`/`Fake*` double referenced from `apps/server/src/modules/presentation/publish.int.spec.ts` or similar), or (b) add a MinIO service to the e2e job/playwright webServer setup analogous to `compose-smoke`'s. (a) is more consistent with AD-007's existing "storage/asset reserved for CI" carve-out being about integration tests, not e2e — but this is a call for whoever owns the fix, not this Verifier.
- **Verify**: `pnpm --filter @arch-canvas/web run test:e2e` passes end to end, reaching and passing the pixel-color assertions in `shared-presentation.spec.ts`.
- **Done when**: SRF-04's Done-when checkbox in `tasks.md` is genuinely true — the gate command it names actually passes in a clean checkout, not just locally by environmental accident.
- **Priority**: Major (the AC's proof mechanism is sound and well-designed; it simply never runs, which is exactly the kind of "gate declared green without the artifact actually working" failure mode `.specs/STATE.md` itself calls out elsewhere in this repo's history).

---

## Requirement Traceability Update

`spec.md`'s table already marks SRF-01..04 as `Done` — left unchanged, since T1/T2/T3's code and unit-level tests are genuinely complete and correct. This validation.md is the record that SRF-04's *e2e execution* remains unverified pending Fix 1; `spec.md`'s per-requirement `Done` status is a task-completion marker (T1/T2/T3 were all attempted and delivered code+tests), not a claim that every gate has been proven green, and this report is the artifact that makes that gap explicit rather than silent.

| Requirement | Previous Status | New Status |
| ----------- | ---------------- | ---------- |
| SRF-01 | Done | ✅ Verified (unit) |
| SRF-02 | Done | ✅ Verified |
| SRF-03 | Done | ✅ Verified (unit) |
| SRF-04 | Done | ✅ Verified — e2e passes after Fix 1 |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 6/6 criteria (including both edge cases) matched the spec-defined outcome with passing evidence, including SRF-04's e2e proof after Fix 1.
**Sensor**: 1/1 mutation killed — the unit-level fix (T1, the actual bug fix) is genuinely discriminating.
**Gate**: `make ci` passes (0 failed, `TURBO_FORCE=true`, zero cache hits); the feature-specific e2e gate (`pnpm --filter @arch-canvas/web run test:e2e`) passes 3/3.

**What works**: The real bug — `SharedResourcePage` navigating frames without remounting `<Excalidraw/>` — is fixed correctly (`key={frame.id}`), proven by unit tests that track real React mount/unmount identity rather than prop capture (a stronger signal than what hid the original bug), and by an e2e test against the real, unmocked Excalidraw that now actually runs to completion. The comment and test that fixed the wrong premise are corrected accurately. The `/share` cold-navigation limitation is a real, independently-confirmed, properly out-of-scope finding, honestly logged as separate open debt.

**Issues found and resolved**: T3's e2e test initially could not complete because `publishPresentation` needs a storage client and the e2e harness built a real, unreachable S3 client. Fixed by injecting the same fake storage double `apps/server`'s own integration suite already established — see "Fix 1 — Resolved".

**Next steps**: none for this feature. `.specs/STATE.md`'s open-debt list should retain only the separate `/share` cold-navigation item, not this one.
