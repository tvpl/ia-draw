# Platform Maturity — Validation (onda F6, rodada 2)

**Date**: 2026-08-16
**Spec**: `.specs/features/platform-maturity/spec.md`
**Tasks**: `.specs/features/platform-maturity/tasks.md` (T1–T22)
**Diff range**: `89e6b4f..7e70fa9` (26 commits, branch `feature/improvements`)
**Scope**: F6 only — TRU-01..04, CIQ-01..07, UIX-01..04 (15 requirements). AGT/GOV/API/MCP (F7–F9) are out of scope and not built.
**Verifier**: independent sub-agent, round 2 (author ≠ verifier, and verifier ≠ round-1 verifier). Every finding below was re-derived from the tree, not inherited from round 1.

---

## Verdict

**Result**: PASS

**✅ PASS** — 15/15 in-scope ACs are covered with `file:line` evidence and no AC fails as written. Both round-1 blockers are genuinely closed and I confirmed each by mutation, not by reading the fix worker's account: the route extractor now scans all of `apps/server/src` and the published total (**82**) matches an independent count of the real tree; the capability-map gate now rejects the exact artefact that survived round 1. The gate is green (`lint`/`typecheck`/`test-unit`, 760 unit tests, 45 in `repo-tools`). The discrimination sensor ran 15 mutations: **10 killed, 4 survived, 1 inert**. None of the four survivors falsifies an AC — each sits outside the AC's literal text and is declared in the tasks — so they are recorded as ranked residuals rather than blockers.

Four items remain flagged and are listed under Ranked Residuals: UIX-02's roadmap-index-versus-per-capability-spec reading (unaddressed since round 1), TRU-02b's prose-side gate that does not exist, the "declared but worthless" coverage-floor hole, and the compose health budget that can reach 7 minutes for one service.

---

## What round 1 found, and what changed

Round 1 (`63e4300`, verdict **FAIL**) reported 11/15 ACs matched, 2 failed as written, and 1 surviving mutant. Its six ranked gaps and their disposition in round 2:

| # | Round-1 gap | Fixed by | Round-2 finding |
| --- | --- | --- | --- |
| 1 | Inventory scanned only `apps/server/src/modules`; published **79** routes; UIX-01's Independent Test false | `2757437` (T18), `1746323` (T21) | **Closed.** Independent count = 82; propagated everywhere; mutation N3 (revert the scan root) is killed by 3 tests |
| 2 | Surviving mutant M6 — `ui_surface` proved existence, not that the file is a surface | `552f8c1` (T19) | **Closed.** Mutation N1 reproduces M6 verbatim and is now killed |
| 3 | CIQ-03 — Playwright ran against its own `webServer`, not "o stack real" | `7e70fa9` (spec amendment) | **Resolved by amendment.** Judged on its merits below — legitimate, with one generous clause |
| 4 | "não depende de disciplina de quem escreve documentação" overstated the gate | `c623370` (T22) | **Closed.** `grep -rn 'disciplina' README.md docs/architecture-overview.html` → no match; replacement text is exactly accurate |
| 5 | Edge case "new package with no coverage floor" ungated | `7c69c82` (T20) | **Closed.** `checkCoverageFloors` wired into `runAudit`; mutations N5, N6, N9 all killed |
| 6 | `spec.md` marked CIQ-07 `Pending` | `c623370` (T22) | **Closed.** `spec.md:201` now reads `Implementing` |

Round 1's own three drafted lessons are judged on their merits under Lessons below.

---

## Task Completion

All 22 tasks are `✅ Complete` in `tasks.md`, each with exactly one atomic commit in the range; 26 commits, all Conventional-Commits conforming (re-derived below, not taken from round 1). No task is partial or blocked. The Phase-5 fix round (T18–T22) maps 1:1 to commits `2757437`, `552f8c1`, `7c69c82`, `1746323`, `c623370`; the CIQ-03 amendment is `7e70fa9`.

---

## Spec-Anchored Acceptance Criteria

### P1 — Documentação que não promete o que não existe (TRU)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| **TRU-01** versioned map records backend evidence + UI-surface path per announced capability | every entry carries `capability`, `requirements`, `backend_evidence`, `ui_surface` | `tools/repo-tools/src/capabilityMap.ts:11` — `const REQUIRED_FIELDS = ['capability','requirements','backend_evidence','ui_surface']`; `capabilityMap.spec.ts:227` — `expect(violations[0]).toEqual({ entry: 'Docgen', problem: 'missing required field \`backend_evidence\`' })`; `capabilityMap.spec.ts:240` — `expect(checkCapabilityMap(map, REPO_ROOT)).toEqual([])` against the real 26-entry `docs/capability-map.yaml` | ✅ PASS |
| **TRU-02a** null surface ⇒ classified `backend-only` | an entry with `ui_surface: null` and no `status: backend-only` is a violation | `capabilityMap.ts:71-77`; `capabilityMap.spec.ts:170-172` — `expect(violations).toHaveLength(1)`, `expect(violations[0]?.entry).toBe('Comentários')`, `expect(violations[0]?.problem).toContain('backend-only')`; accept path `capabilityMap.spec.ts:193` — `expect(violations).toEqual([])` | ✅ PASS |
| **TRU-02b** product docs SHALL present such a capability in that condition, never as delivered | README/landing describe no `backend-only` capability as user-reachable | **no automated evidence** — `cli.ts:83-130` reads `docs/capability-map.yaml`, the server tree, `apps/web/src` and `pnpm-workspace.yaml`; it never opens `README.md` or `docs/architecture-overview.html`. Verified by hand entry-by-entry (see Documentation honesty): correct today. `README.md:7` and `docs/architecture-overview.html:947-953` now *say so themselves* — "O portão cobre o mapa contra o código, não este texto contra o mapa" | ⚠️ Ungated — correct by hand, honestly declared as human review, not proved by CI |
| **TRU-03** CI fails if any entry declares a UI path absent from `apps/web/src` | non-zero exit naming the entry | `capabilityMap.ts:99-104` (`existsSync`); `capabilityMap.spec.ts:47-49` — `expect(violations).toHaveLength(1)`, `expect(violations[0]?.entry).toBe('Dock de IA')`, `expect(violations[0]?.problem).toContain('apps/web/src/ai/AiDock.tsx')`; outside-root `capabilityMap.spec.ts:69-71`; CLI `cli.spec.ts:68` — `expect(result.exitCode).toBe(1)` and `cli.spec.ts:74-75` naming both offenders; CI wiring `.github/workflows/ci.yaml:263-288`. Sensor N10 (drop `existsSync`) kills 3 tests | ✅ PASS |
| **TRU-04** README + landing declare the requirement count as verified backend contract, plus the count of capabilities still without surface | 92 as backend contract; 26 capabilities / 4 with UI / 22 backend-only; 82 routes / 4 / 78 | `README.md:5` (92 as "contrato de backend verificado"), `README.md:7` ("Das 26 capacidades … 4 têm tela hoje e 22 são `backend-only` … das 82 rotas REST registradas, 4 são consumidas … e 78 não têm consumidor"); `docs/architecture-overview.html:937-946`, `:1617`, `:1679`, `:1810`. All six numbers re-derived independently below | ✅ PASS |

### P1 — CI que prova o sistema de pé (CIQ)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| **CIQ-01** boot the full stack via `docker compose up --build`, fail if any service is not `healthy` within 5 min | red job, never a hung one | `.github/workflows/ci.yaml:210` `docker compose build` (deliberately outside the budget), `:215` `timeout 300 docker compose up -d`, `:222` `docker compose up -d --wait --wait-timeout 120 proxy server web postgres minio redis`. `infra/compose/compose.yaml:56-67`: every service except `redis` is gated by `condition: service_healthy` inside the 300 s, so the 5-minute budget binds for them | ⚠️ PASS with a precision note: `redis` is `service_started` (`compose.yaml:66-67`), so it alone can consume 300 + 120 = **7 min** before the job turns red |
| **CIQ-02** `GET /health/ready` on the public port ⇒ HTTP 200, `status == ok`, `postgres == up` | all three asserted | `.github/workflows/ci.yaml:227-244`. Assertion block extracted verbatim and exercised by me against six synthetic bodies: `200/ok/up` → exit 0; `status=degraded` → exit 1; `postgres=down` → exit 1; `dependencies: []` → exit 1; `postgres` absent from `dependencies` → exit 1; `HTTP 503` → exit 1. Response shape re-confirmed against `apps/server/src/core/server.ts:212-236` — `{status, dependencies:[{name,status}]}`, 503 when any dep is down | ✅ PASS |
| **CIQ-03** run the Playwright suite against genuinely running servers — real API and frontend, **never mocks or intercepted responses** — and fail on any test failure; containerized-stack fidelity delegated to CIQ-01/02 (**amended text**, `spec.md:80`) | a real server process and a real frontend process, zero request interception | `.github/workflows/ci.yaml:167` — `playwright test --reporter=list,html`; `apps/web/playwright.config.ts:26-40` starts two real processes: `runTestServer.ts` (a genuine `buildServer` + `registerAuthModule`/`registerWorkspaceModule`/`registerDiagramSyncModule` instance over PGlite, `apps/web/e2e/support/runTestServer.ts:11-45`) and Vite's real dev server. `grep -n "route(\|mock\|fulfill\|intercept" apps/web/e2e/*.spec.ts` → **no match**; the suite drives the real API (`crash-recovery.spec.ts:43` posts to `${TEST_SERVER_ORIGIN}/auth/login`) | ✅ PASS on the amended text — with the "nunca mocks" clause itself ungated (see judgment below) |
| **CIQ-04** coverage below a package's declared floor ⇒ CI fails naming package, floor and measured value | all three named | 12 configs carry `coverage.enabled: true` + numeric `thresholds` (e.g. `packages/diagram-domain/vitest.config.ts:21-29` — `lines: 98.02, functions: 93.33, branches: 93.82, statements: 98.02`). Package name comes from turbo's line prefix under `pnpm -w test:unit`, confirmed in the forced uncached run below. Edge case now gated: `tools/repo-tools/src/coverageFloors.ts:72-102`; `coverageFloors.spec.ts:73-75` — `expect(violations[0]?.package).toBe('packages/newcomer')` + `expect(violations[0]?.problem).toContain('coverage.thresholds')`; `:87-88` (no config at all); `:103-104` (empty `thresholds: {}`); `:128` (`packages/database` legitimately exempt); `:136` — `expect(checkCoverageFloors(REPO_ROOT)).toEqual([])`; CLI wiring `cli.ts:124-129` + `cli.spec.ts:117-118` | ✅ PASS |
| **CIQ-05** validate every PR commit message, fail identifying the **first** non-conforming one | stops at the first offender | `.github/workflows/ci.yaml:45-61` (`git rev-list --reverse --no-merges`, loop, `exit 1` on first failure). Job body executed by me as bash: real range `89e6b4f..HEAD` → exit 0, "26 commit messages conform to Conventional Commits."; disposable 3-commit repo with `feat(a): first` → `mensagem invalida` → `fix(b): third` → **stopped at `mensagem invalida`, never reached `fix(b)`** | ✅ PASS |
| **CIQ-06** no Docker daemon ⇒ job fails explicitly, never skipped as success | explicit red | `.github/workflows/ci.yaml:194-202`. Branch exercised by me with `DOCKER_HOST=tcp://127.0.0.1:1`: prints `::error::no Docker daemon on this runner - the compose smoke gate cannot be skipped into a green build` and exits 1 | ✅ PASS |
| **CIQ-07** automated dependency updates, grouped per ecosystem, each subject to the full suite | grouped PRs, majors isolated, Node pinned to 22.x | `.github/renovate.json` — 8 ecosystem groups, `constraints.node: ">=22 <23"`, a `node` rule with `allowedVersions: "<23"`, and a final `matchUpdateTypes: ['major']` rule with `groupName: null`. "Full suite on each PR" follows from `ci.yaml:4` `on: pull_request`. `spec.md:201` traceability row now reads `Implementing` (round-1 gap 6 closed) | ⚠️ PASS on config; Renovate needs the app installed on the repo — not provable here |

### P1 — Inventário e decomposição do gap de produto (UIX)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| **UIX-01** inventory maps **every registered REST route** to its consuming UI surface, explicitly marking routes with no consumer | consumed + pending == total registered in the server | `serverRoutes.ts:22` — `const SERVER_SOURCE_DIR = 'apps/server/src'`; `serverRoutes.spec.ts:102` — `expect(routes.length).toBeGreaterThanOrEqual(82)`; `serverRoutes.spec.ts:116-130` names the three previously-missed routes one by one (`expect(routes).toContainEqual({ method: 'GET', path: '/health/ready', file: 'apps/server/src/core/server.ts' })`); invariant `routeInventory.spec.ts:66-69` — `expect(inventory.totals.consumed).toBe(2)`, `.pendingProduct).toBe(3)`, `expect(consumed + pendingProduct).toBe(routes.length)`, `expect(totals.routes).toBe(routes.length)`. Independent count over the whole tree = **82**; `docs/route-inventory.md:5-8` = 82/4/78/0 | ✅ PASS |
| **UIX-02** each capability without surface enters the product roadmap as its own spec in `.specs/features/`, squad-sized | one roadmap entry per `backend-only` capability, each destined to be its own spec | `.specs/features/platform-maturity/ui-roadmap.md` — 16 `### R*` entries + 6 declared operational surfaces = 22, matching the 22 `status: backend-only` map entries exactly (`ui-roadmap.md:211-214` closes the count). Each entry declares scope, backend routes, dependencies and a wave estimate. Only `.specs/features/ai-dock/spec.md` is an actual spec file | ⚠️ Spec-precision gap — the AC says "spec própria em `.specs/features/`"; what exists is a roadmap **index** that defers each spec to its own Specify round. Licensed by the Out of Scope and Assumptions rows, but the AC text is stronger than the delivery. Unaddressed since round 1 |
| **UIX-03** specify the AI dock as the first vertical slice | complete EARS spec | `.specs/features/ai-dock/spec.md` (23 requirements, prefix `DOCK`). `python3 .claude/skills/tlc-spec-driven/scripts/validate_spec.py .specs/features/ai-dock/spec.md` → exit 0 | ✅ PASS |
| **UIX-04** a new REST route with no UI consumer is recorded as `pending-product`, never unclassified | classification `pending-product`, no escape category | `routeInventory.ts:5` — `export type RouteClassification = 'consumed' \| 'pending-product'`; `routeInventory.spec.ts:35-36` — `expect(inventory.routes[0]?.classification).toBe('pending-product')` + `expect(consumedBy).toEqual([])`; no-escape `routeInventory.spec.ts:45-49` — `expect(routes.map(e => e.classification)).toEqual(['consumed','pending-product','pending-product'])`; near-miss `:105-108`. Sensor N11 (force everything to `consumed`) kills 5 tests | ✅ PASS |

**Status**: 15/15 ACs covered with `file:line` evidence · **0 fail as written** · 4 ⚠️ flagged (TRU-02b ungated, CIQ-01 precision, CIQ-07 not provable here, UIX-02 spec-precision)

---

## Independent number verification

The last two rounds each published a wrong route count, so every number was re-derived from the tree rather than read from an artifact.

| Claim | How I derived it | Verdict |
| --- | --- | --- |
| **82** registered routes | `perl -0777` slurp of `\bapp\.(get\|post\|put\|patch\|delete\|head\|options)\(\s*'([^']*)'` over every non-`*.spec.ts` file in `apps/server/src` → **82**. Cross-check: `grep -rE "\bapp\.(get\|…)\("` (no quote required) → also **82**, so no registration uses a non-literal path and nothing is missed. A single-line-only grep gives 51, which is how the original 48 estimate went wrong | ✅ |
| Only 3 routes live outside `modules/` | `apps/server/src/core/server.ts:210` `/health/live`, `:212` `/health/ready`, `:246` `/metrics` — nothing else | ✅ |
| No other registration idiom | `grep -rE "\b(fastify\|server\|instance\|router\|scope)\.(get\|…\|route)\("` over `apps/server/src` → **no match**; `app.route(` → no match | ✅ |
| 4 consumed / 78 pending | `pnpm --filter @arch-canvas/repo-tools run audit` → `82 routes, 4 consumed, 78 pending-product`, exit 0; `git status --porcelain` **empty** afterwards, so `docs/route-inventory.md` regenerates byte-identical | ✅ |
| **26** capabilities | `grep -c '^  - capability:' docs/capability-map.yaml` = 26 | ✅ |
| **22** backend-only / **4** with UI | `grep -cE '^    status: backend-only'` = 22; `grep -c 'ui_surface: null'` = 22; non-null `ui_surface` = 4 (`DiagramEditorPage.tsx` ×2, `syncClient.ts`, `AppShell.tsx`) — all four exist on disk | ✅ |
| Roadmap closes on 22 | `grep -c '^### R'` = 16, plus 6 declared operational = 22 (`ui-roadmap.md:211-214`) | ✅ |

**Invariant `consumed + pending == total` in every published place:**

| Surface | Text | Sums? |
| --- | --- | --- |
| `docs/route-inventory.md:5-7` | 82 / 4 / 78 | ✅ |
| `docs/capability-map.yaml:17-18` | "4 das 82 … e 78 não têm — 4 + 78 = 82" | ✅ (states the sum explicitly) |
| `README.md:7` | "das 82 rotas REST registradas, 4 são consumidas … e 78 não têm consumidor" | ✅ |
| `docs/architecture-overview.html:945-946` | "das 82 rotas REST registradas, 4 são consumidas … e 78 não têm consumidor" | ✅ |
| `spec.md:7` (Problem Statement) | "82 rotas REST … 4 rotas consumidas, 78 sem superfície de produto" | ✅ |
| `ui-roadmap.md:12` | "82 rotas REST registradas, 4 consumidas pela UI, 78 `pending-product`" | ✅ |

**Residue check:** `grep -rn '79 rotas\|79 routes\|75 pending\|75 sem consumidor'` over `README.md`, `docs/` and this feature's specs returns hits only in `tasks.md`'s historical implementation notes and in round 1's own report text — i.e. only where the old number is being *described as wrong*, never where it is being published.

---

## Discrimination Sensor

**Isolation**: one temporary `git worktree` (`git worktree add <scratchpad>/mut HEAD --detach`), with `node_modules` symlinked in from the real tree so nothing was installed into it. **No `git stash` at any point.** Baseline `git status --porcelain` on the real tree was **empty** before the sensor; each mutation was reverted with `git checkout -- .` *inside the worktree*; the worktree was removed with `git worktree remove --force`; the real tree's porcelain after cleanup is **empty**, matching the baseline. Runner: `vitest run` in `tools/repo-tools`, 45 tests baseline green in the scratch.

| # | Target | Mutation | Result |
| --- | --- | --- | --- |
| **N1** | `docs/capability-map.yaml:46` | **Round-1 survivor M6, verbatim.** Repoint "Recuperação após crash do navegador" from `syncClient.ts` to `apps/web/src/i18n/locales/en/translation.json` | ✅ **Killed** — `capabilityMap.spec.ts:237` "passes against the real docs/capability-map.yaml". **M6 is genuinely dead.** |
| **N2** | `docs/capability-map.yaml:46` | **M6's successor form.** Repoint the same capability at `apps/web/src/app-shell/AppShell.tsx` — a real component module, but the wrong one | ❌ **Survived** — 45/45 green. Out of AC scope: TRU-03 requires failing on a path that "não exista em `apps/web/src`". Declared limit, `tasks.md:789` |
| **N3** | `serverRoutes.ts:22` | Revert the scan root to round 1's `'apps/server/src/modules'` | ✅ **Killed** — 3 failures: the ≥82 floor, the named-health-routes test, and the outside-modules `*.spec.ts` test |
| **N4** | `serverRoutes.ts:29` | Drop the `\bapp\.` anchor from `ROUTE_PATTERN` so any receiver counts | ⚪ **Inert** — not a valid mutant. Measured: no non-`app` receiver uses `.get('…')` in `apps/server/src` today, so the mutation yields the same 82 routes. Recorded for honesty, excluded from the score |
| **N5** | `coverageFloors.ts:82` | Invert the guard: skip packages that **have** `test:unit` | ✅ **Killed** — 6 failures across `coverageFloors.spec.ts` and `cli.spec.ts` |
| **N6** | `coverageFloors.ts:26` | `declaresCoverageThresholds` returns `true` for any `coverage:` block, ignoring whether a number is declared | ✅ **Killed** — `coverageFloors.spec.ts:91` "fails on a thresholds block that declares no number" |
| **N7** | `serverRoutes.ts:67` | **Over-count probe.** Emit every discovered route twice (published total 82 → 164). Tests the real-repo assertion being a `>=` floor | ✅ **Killed** — 6 failures. The floor is backstopped by fixture-level `toEqual` assertions, so over-counting is not a blind spot |
| **N8** | `capabilityMap.ts:34` | Drop the `locales/` segment exclusion from `isComponentModule` | ✅ **Killed** — `capabilityMap.spec.ts:99` "rejects a locale file even when it carries a module extension" |
| **N9** | `cli.ts:129` | `runAudit` exit code ignores `floorViolations` | ✅ **Killed** — `cli.spec.ts:102` |
| **N10** | `capabilityMap.ts:99` | **Round-1 M1 re-run.** Drop the `existsSync` check entirely | ✅ **Killed** — 3 failures across `capabilityMap.spec.ts` and `cli.spec.ts` |
| **N11** | `routeInventory.ts:74` | Force `classification: 'consumed'` for every route — the invariant still sums, the classification lies | ✅ **Killed** — 5 failures |
| **N12** | `serverRoutes.ts:32` | `isProductionSource` drops the `*.spec.ts` exclusion, so fixture routes leak in | ✅ **Killed** — 4 failures |
| **N13** | `.github/workflows/ci.yaml:222,240-244` | **Round-1 M4 re-run.** Delete the `postgres == up` assertion and strip `--wait-timeout 120` | ❌ **Survived** — 45/45 green. Survived by declared design: `tasks.md:26` sets workflow YAML to `Test Type: none`. Compensating evidence: I exercised the assertion block myself against 6 synthetic bodies (CIQ-02 row) |
| **N14** | `packages/diagram-domain/vitest.config.ts:23-28` | Set every threshold to `0` — a floor is declared, and it is worthless | ❌ **Survived** — `checkCoverageFloors` accepts any numeric threshold. Outside CIQ-04's literal text (a declared 0 *is* a declared floor) but a real hole in the ratchet's spirit |
| **N15** | `packages/diagram-domain/vitest.config.ts:22` | Remove `coverage.enabled: true`, keeping `thresholds` | ❌ **Survived** — and this one bites: `test:unit` is bare `vitest run`, so without `enabled` the floor never runs. Declared at `tasks.md:831` |

**Sensor depth**: 15 mutations (P0-full tier — this wave *is* the integrity gate for everything else)
**Result**: **10 killed / 4 survived / 1 inert** (of 14 valid mutants: 10 killed, 4 survived)

**Judgment on the survivors.** None falsifies an AC:

- **N2** exceeds TRU-03, which is a pure existence requirement. Round 1's M6 pointed at a translation catalogue — a claim that was *false on its face*; that class is now dead (N1). N2 points at a real component, which no filesystem check can distinguish from the right one without an import-graph walk. `tasks.md:789` declares exactly this boundary.
- **N13** targets a layer with no possible suite, declared as such in the Test Coverage Matrix before implementation, and compensated by reproductions I ran independently for CIQ-02, CIQ-05 and CIQ-06.
- **N14/N15** target `vitest.config.ts` data, not code introduced by the fix round; both are declared limits and both sit outside the AC's literal text. They belong in the ranked residuals, and N15 is the one I would fix first.

---

## Gate Check

- **Declared Build gate**: `make ci` (`tasks.md:39`)
- **Substitution applied** (pre-existing, unrelated to this wave, and identical to round 1's substitution): `make ci` runs `test-integration`, which needs `pg_lsclusters` and `redis-server`; neither is installed on this host. Those are `ENOENT` spawn errors, never assertion failures. Ran `make lint && make typecheck && make test-unit`, per the environment note at `tasks.md:122`.
- **Node**: v22.23.2 (`fnm use 22 && corepack enable`), as the spec's Assumptions row mandates.

| Step | Result |
| --- | --- |
| `make lint` | ✅ 425 files checked, 0 errors, 4 warnings (pre-existing) |
| `make typecheck` | ✅ 24/24 tasks successful |
| `make test-unit` | ✅ 23/23 tasks successful, all coverage floors met |
| `turbo run test:unit --force` (uncached, all 12 packages) | ✅ 23/23 successful — **760 unit tests**: server 360, ai-tools 70, auth 63, diagram-ir 60, editor-adapter 54, **repo-tools 45**, diagram-domain 29, web 28, shared-contracts 27, library-content 12, test-fixtures 8, backup 4 |
| `pnpm --filter @arch-canvas/repo-tools run test:unit` | ✅ **45 passed** in 6 files — serverRoutes 9, capabilityMap 10, coverageFloors 7, routeInventory 7, webConsumers 6, cli 6. Matches the claim exactly (was 31 in round 1) |
| `pnpm --filter @arch-canvas/repo-tools run audit` | ✅ exit 0, `82 routes, 4 consumed, 78 pending-product`; artifact regenerates byte-identical (`git status --porcelain` empty) |

**Test count delta**: round 1 measured 31 tests in `repo-tools`; round 2 measures **45** (+14: serverRoutes +3, capabilityMap +3, coverageFloors +7, cli +1). **No test was deleted, skipped or weakened** — every pre-existing assertion in the five original spec files is still present, and the fix round only added.

---

## CI Gates — real or theatre?

Each row was re-derived in round 2, not copied.

| Job | Would it fail on the defect it claims to catch? | Basis |
| --- | --- | --- |
| `commit-lint` (`ci.yaml:29-61`) | **Yes.** Stops at the first non-conforming message and names it | Job body run as bash on the real 26-commit range (exit 0) and on a disposable repo with a bad *middle* commit (stopped there, never reached the third) |
| `capability-audit` (`ci.yaml:263-288`) | **Yes** for a removed, relocated, non-module or locale surface (N1, N8, N10 killed). **No** for a real-but-wrong component (N2) | Sensor + `cli.spec.ts:68,74-75` |
| `capability-audit` — coverage floors | **Yes.** A package with `test:unit` and no `thresholds` turns the job red, naming the package | `cli.ts:124-129`; `cli.spec.ts:117-118`; sensor N5, N6, N9 |
| `compose-smoke` (`ci.yaml:185-261`) | **Yes for all three assertions**, and for two shapes round 1 did not test: a missing `postgres` dependency and an empty `dependencies` array both exit 1 | Assertion block extracted verbatim and run against 6 synthetic bodies |
| `compose-smoke` — Docker absent (`:194-202`) | **Yes.** Explicit red, never a silent skip | Exercised with `DOCKER_HOST=tcp://127.0.0.1:1` → exit 1 with the `::error::` line |
| `e2e` (`ci.yaml:133-183`) | **Yes**, against real processes — a real `apps/server` instance and Vite's real dev server, with zero request interception in the suite | `playwright.config.ts:26-40`, `runTestServer.ts:11-45`, `grep` for `route(`/`mock`/`fulfill`/`intercept` in `apps/web/e2e/*.spec.ts` → no match |
| Coverage floors (12 × `vitest.config.ts`) | **Yes**, provided `coverage.enabled: true` is present — which nothing enforces (N15) | Forced uncached `test:unit` run; sensor N15 |

**Not theatre.** The compose-smoke job is the opposite of the pattern it was written to fix: it builds outside the health budget, waits with a hard timeout, and asserts a *parsed body* rather than a status line. Its one structural weakness is unchanged from round 1 — nothing protects the YAML itself from being gutted (N13).

---

## Documentation honesty — plain judgment

Read as an outsider: **neither `README.md` nor `docs/architecture-overview.html` asserts a capability the user cannot reach, and no claim is now stronger than the gate behind it.**

- The README splits "O que é" into **"Com tela hoje"** (`README.md:11-14`, the exact 4 capabilities with `ui_surface` in the map) and **"Contrato de backend verificado, ainda sem tela"** (`:16-20`). The AI engine — the product's declared differentiator — is in the second list and named as such, including "É o diferencial declarado do produto e a primeira fatia do roadmap de UI." The opening line already qualifies it: "um motor de IA geradora de diagramas **entregue como API**."
- The landing carries a hero `.status-panel` (`:934-955`) plus `contrato de backend · sem tela` flags on sections 02, 04, 05 and 06 — every section describing a `backend-only` capability. Sections 01 and 03 (partial surface) carry `.surface-note`s separating what opens from what does not. Section 07 makes no capability claim. The mockup caption states outright that "nenhum componente equivalente existe hoje em `apps/web`" (`:930-932`).
- All the `92/92` mentions (`:961`, `:1612`, `:1679`, `:1810`) are qualified as **backend** requirements.

**Round-1 snag 2 is fixed and fixed correctly.** `grep -rn 'disciplina' README.md docs/architecture-overview.html` → **no match**. The replacement is precise rather than merely softened: "O portão cobre o mapa contra o código, não este texto contra o mapa — a correspondência entre a prosa daqui e as entradas do mapa continua sendo revisão humana" (`README.md:7`, mirrored at `docs/architecture-overview.html:947-953`). That is exactly what `cli.ts` does and exactly what it does not do. A document that names the limit of its own gate is the strongest evidence in this wave that the honesty rewrite is real rather than cosmetic.

**Register: honest precision.** Not spin — the deficit is stated in the hero, not in a footnote, and the 22-without-a-screen number is repeated in the page footer. Not self-flagellation either — "É a parte forte do trabalho e ela está de pé" (`:939-940`) keeps the earned credit, and "A superfície de produto vem atrás e é medida à parte" states the gap without theatrics. Both documents read like an engineer reporting status to a peer.

**One residual, carried from round 1 and unchanged:** the 4th surface is thin. `apps/web/src/app-shell/AppShell.tsx` is a header, a language switcher and an empty `<main />` carrying the comment `nav/search/admin land here in F1+` — the very artifact the spec's Problem Statement cites as evidence of the gap. Counting "Acessibilidade do shell da aplicação" among the 4 delivered capabilities is defensible (it renders, and it has a test) but it flatters the number; `syncClient.ts` is likewise a module, not a screen. The map is not wrong, but "4 têm tela" is the most generous true reading of the data.

---

## CIQ-03 amendment — judgment on its merits

**Legitimate, with one clause that reaches further than what it delegates to.**

The amended AC (`spec.md:80`) reads: execute the Playwright suite "contra servidores genuinamente em execução — API e frontend reais, nunca mocks nem respostas interceptadas — e falhar se qualquer teste falhar; a fidelidade do stack containerizado é coberta separadamente por CIQ-01 e CIQ-02."

**Why it is not laundering:**

1. **It is falsifiable and non-trivial.** "Nunca mocks nem respostas interceptadas" rules out the single most common way an e2e suite fakes its passing grade — `page.route()` fulfilling responses. I checked: the suite has none, and both `webServer`s are real processes. A weaker implementation would violate this AC as written. An AC rewritten purely to match the code would not have that property.
2. **The narrowing is stated in the AC itself, not hidden.** The delegation clause tells the reader, in the requirement text, that containerized fidelity is *not* what this AC buys. Round 1's actual complaint was that the divergence lived only in `tasks.md:464` and therefore "reads as verified coverage at validation time." Moving it into the spec is the correct remedy, not a cosmetic one.
3. **The rationale is recorded with its provenance.** `spec.md:47` gives the reason ("o valor que a AC buscava é 'sem mocks'"), the cost avoided, and marks the amendment as explicitly user-approved rather than silently applied. That row is the audit trail.
4. **The delegated coverage genuinely exists.** CIQ-01 and CIQ-02 are not aspirational — I exercised both this round.

**Where it reaches too far:** "a fidelidade do stack containerizado é coberta separadamente por CIQ-01 e CIQ-02" says *covered*. What CIQ-01/02 actually prove is that the containerized stack **boots and answers `/health/ready`**. No job in CI drives a browser against `http://localhost:8080`, and the e2e suite runs against Vite's dev server and a PGlite-backed API, not the production build behind the proxy. So a bug that only manifests in the built SPA or through the proxy is caught by nothing. "Coberta" should read "a fidelidade de boot e saúde do stack containerizado" — one degree, the same degree the README sentence was corrected by in T22.

**Second residual:** the "nunca mocks" clause is itself ungated. Nothing fails if someone adds `page.route()` tomorrow. That is the same class as TRU-02b — a true claim with no gate behind it — and it is worth a one-line check in the `e2e` job.

**Bottom line: I bless the amendment.** It narrows a guarantee honestly, in the requirement text, with recorded approval, and what remains is still a real property that a lazy implementation would fail. It is not compliance-by-redefinition.

---

## Edge Cases (F6 subset)

- [x] Capability map pointing at a component removed in a refactor ⇒ CI fails — `capabilityMap.spec.ts:47-49`; sensor N10
- [x] Healthcheck flapping ⇒ final state after the timeout decides — `ci.yaml:216-222`; `--wait` evaluates final state, documented inline at `:217-221`
- [x] **New package with no declared coverage floor ⇒ CI fails demanding the declaration** — **now handled** (was the ungated edge case in round 1). `coverageFloors.ts:72-102`, three evasions closed (no `coverage` block, no config file, empty `thresholds: {}`); sensor N5, N6, N9 all killed. Caveat: a `thresholds: { lines: 0 }` declaration satisfies the gate (N14)
- n/a MCP cross-workspace token, empty OpenAPI, `STATE.md` merge — F8/F9

---

## Code Quality

| Principle | Status |
| --- | --- |
| No features beyond what was asked | ✅ — the Phase-5 fix round touched exactly the files its `Where` clauses name, plus two declared additions (`spec.md` Problem Statement, `ui-roadmap.md`) that would otherwise have published the stale number |
| No abstractions for single-use code | ✅ — `isComponentModule` and `declaresCoverageThresholds` are private predicates, not exported strategy objects |
| No unnecessary flexibility | ✅ |
| Only touched files required for the tasks | ✅ |
| Didn't "improve" unrelated code | ✅ |
| Matches existing patterns/style | ✅ — `coverageFloors.ts` mirrors `capabilityMap.ts` exactly: `{ package, problem }` violations returned as a list, never thrown |
| Would a senior engineer approve? | ✅ — and the round-1 defects were fixed at the root (scan root widened, predicate strengthened) rather than patched at the reporting layer |
| Tests map to ACs, non-shallow | ✅ — every `describe` names its requirement IDs; assertions target values, not shapes |
| Spec-anchored outcome check | ✅ — 15/15 ACs; 1 spec-precision gap flagged (UIX-02) |
| Per-layer Coverage Expectation met | ✅ domain logic 1:1 with ACs (94.09% lines in `repo-tools`, floor 92.2); ⚠️ workflow layer has no possible suite, by declared design |
| Every test maps to a spec AC / edge case / Done-when | ✅ — 45/45 accounted for, no unclaimed tests |
| Documented project guidelines followed | none exist (no `CLAUDE.md`/`CONTRIBUTING.md` — that is AGT-01, wave F7) — strong defaults applied |

---

## Ranked Residuals (non-blocking)

Not fix tasks for this wave — none blocks the verdict. Ranked by what I would fix first.

1. **Coverage floor can be declared without being enabled** (Minor, CIQ-04 — sensor N15). Removing `coverage.enabled: true` while keeping `thresholds` leaves the floor decorative, because `test:unit` is bare `vitest run`. `coverageFloors.ts` requires `thresholds`, not `enabled`. One-line fix in `declaresCoverageThresholds`. Declared at `tasks.md:831`.
2. **UIX-02's AC text is stronger than the delivery** (Minor, unaddressed since round 1). Either tighten the AC to "entra no roadmap de produto, cada entrada dimensionada para uma rodada de Specify própria" — which is what shipped and what `ui-roadmap.md` says of itself — or accept that 16 of 22 capabilities have no spec file. Same class of fix as the CIQ-03 amendment, and it should be handled the same way rather than left ambiguous a third round.
3. **A declared floor of `0` passes the gate** (Minor, CIQ-04 — sensor N14). Require a threshold above some floor, or at minimum reject `0`.
4. **CIQ-03's delegation clause overstates CIQ-01/02** (Cosmetic, wording). Change "a fidelidade do stack containerizado" to "a fidelidade de boot e saúde do stack containerizado". Optionally add a one-line grep in the `e2e` job so "nunca mocks" has a gate.
5. **CIQ-01's health budget reaches 7 minutes for `redis`** (Cosmetic). `redis` is `service_started`, so it falls through the `timeout 300` and into the `--wait-timeout 120`. Either add a `service_healthy` condition or state the two-phase budget in the AC.
6. **Nothing protects `ci.yaml` from being gutted** (Cosmetic, structural — sensor N13, carried from round 1's M4). Inherent to the layer; a workflow-lint or a golden-file assertion on the job's assertion block would close it.

---

## Requirement Traceability Update

| Requirement | Previous | New |
| --- | --- | --- |
| TRU-01 | Implementing | ✅ Verified |
| TRU-02 | Implementing | ✅ Verified (map half gated; docs half correct by review and honestly declared as such) |
| TRU-03 | Implementing | ✅ Verified |
| TRU-04 | Implementing | ✅ Verified (numbers re-derived independently) |
| CIQ-01 | Implementing | ✅ Verified (precision note: 7-min ceiling for `redis`) |
| CIQ-02 | Implementing | ✅ Verified |
| CIQ-03 | Implementing | ✅ Verified against the amended AC |
| CIQ-04 | Implementing | ✅ Verified |
| CIQ-05 | Implementing | ✅ Verified |
| CIQ-06 | Implementing | ✅ Verified |
| CIQ-07 | Implementing | ✅ Verified (config; Renovate installation not provable here) |
| UIX-01 | Implementing | ✅ Verified |
| UIX-02 | Implementing | ⚠️ Verified with a spec-precision gap (roadmap index, not per-capability specs) |
| UIX-03 | Implementing | ✅ Verified |
| UIX-04 | Implementing | ✅ Verified |

---

## Not verifiable here

Stated plainly, because a green local run is not a green pull request.

1. **Anything requiring a real pull-request event**: `github.event.pull_request.base.sha`/`head.sha` arriving populated, `if: github.event_name == 'pull_request'` selecting `commit-lint`, and `on: pull_request` firing all 9 jobs on a Renovate PR (CIQ-07's "full suite on each PR"). The job *bodies* were executed as shell; the event plumbing was not.
2. **`actions/*` behaviour**: `upload-artifact@v4` publishing `compose-diagnostics.txt`, `playwright-report/` and `route-inventory.md`; `if: failure()` / `if: always()` semantics; `actions/cache@v4` hit/miss for `~/.cache/ms-playwright`.
3. **Ubuntu-runner specifics**: `timeout` from coreutils (absent on this macOS host), `playwright install --with-deps` fetching Ubuntu system libraries, and whether the Linux runner's measured coverage lands within floors calibrated on macOS/Node 22.23.2 (`tasks.md:366` flags a possible 0.01-point miss).
4. **CIQ-06 in its true condition**: the Docker-absent branch was exercised by pointing `DOCKER_HOST` at a dead socket, which proves the shell logic; a runner genuinely without Docker is a different environment.
5. **Renovate itself**: `renovate.json` is inert unless the Renovate app (or a self-hosted runner) is installed on the repository. Nothing in the repo proves that.
6. **`make ci` in full**: `test-integration` cannot run here (`pg_lsclusters`, `redis-server` absent — `ENOENT` spawn failures, pre-existing and unrelated to this wave). Substituted with `make lint && make typecheck && make test-unit`.
7. **The compose boot end-to-end**: **not attempted this round and therefore unproven.** A real `docker compose build` + `up` compiles `canvas` from source on Alpine and costs far more than this round could afford; round 1 launched one and it was still building when that report closed. What *is* proven is the assertion logic: the health-gate block was extracted verbatim and shown to reject all six failure shapes, the Docker-absent branch turns red, and `tasks.md:438` records a successful full boot on this machine with the exact response body. This round neither confirms nor contradicts that boot.
8. **The Playwright suite end-to-end**: `make test-e2e` was not run this round. CIQ-03's evidence is structural — the config starts two real server processes and the suite contains no interception — plus `tasks.md:481`, which records `1 passed (30.8s)` locally. Whether the suite passes on the runner is not proven here.

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 15/15 ACs covered with `file:line` evidence · 0 fail as written · 1 spec-precision gap (UIX-02) · 3 ⚠️ notes (TRU-02b ungated, CIQ-01 precision, CIQ-07 unprovable here)
**Sensor**: 15 mutations — 10 killed, 4 survived (all outside AC text, all declared), 1 inert
**Gate**: `make lint` ✅ · `make typecheck` ✅ · `make test-unit` ✅ 760 tests, `repo-tools` 45/45 · `repo-tools audit` exit 0
**Numbers**: 82 / 4 / 78 and 26 / 4 / 22 re-derived independently from the tree; the invariant holds in all six published places

**What works**: the fix round fixed causes, not symptoms. The scan root was widened rather than the number patched; the surface predicate was strengthened rather than the mutant special-cased; the ungated edge case got a real checker wired into the CLI that already runs in CI, so it costs no new job. Ten of fourteen valid mutations died to targeted assertions, including both round-1 survivors' direct forms. The documentation now names the limit of its own gate — "o portão cobre o mapa contra o código, não este texto contra o mapa" — which is the single most credible sentence in the wave, because a project inclined to overstate would not have written it.

**Issues found**: four survivors, none falsifying an AC — a capability can still be repointed at a real-but-wrong component; a coverage floor can be declared without being enabled, or declared as `0`; and the workflow YAML remains unprotected against being gutted. Plus UIX-02's AC text, which has been stronger than its delivery for two rounds and should be amended the way CIQ-03 was.

**Next steps**: no fix tasks required for F6. Route the six ranked residuals into the F7 backlog; residual 2 (UIX-02's AC wording) is the one worth closing before the next Specify round so it does not surface a third time.

---

## F7 Wave Report (Onboarding e loop agêntico) — PASS ✅

**Date**: 2026-08-16
**Spec**: `.specs/features/platform-maturity/spec.md` — P1: "Onboarding e loop agêntico versionados ⭐ F7" (line 106), AGT-01..05
**Tasks**: none — no formal `tasks.md` exists for F7. Per the skill's sizing rules, the wave is Medium scope (≤5 safety-valve steps) and was executed inline as 4 atomic commits, treated below as the task list.
**Diff range**: `d2e4c6d..HEAD` (4 commits: `be76608`, `62ebacf`, `2b4e6b2`, `c945922`) — `CLAUDE.md` (new, 106 lines), `.claude/settings.json` (new, 40 lines), `.claude/commands/audit.md` (new, 20 lines), `.claude/commands/gate.md` (new, 17 lines). Zero application source code touched.
**Scope**: F7 only — AGT-01..05 (5 requirements). TRU/CIQ/UIX (F6, already verified above) and GOV/API/MCP (F8/F9) are out of scope.
**Verifier**: independent sub-agent (author ≠ verifier).

---

### Verdict

**Result**: PASS

5/5 ACs verified with `file:line` evidence, 0 failing as written. `make lint`, `make typecheck` and `make test-unit` are green on Node 22 using only the commands `CLAUDE.md` documents; `make test-integration` fails on the pre-existing, `CLAUDE.md`-disclosed sandbox limitation (missing `pg_lsclusters`/`redis-server`), which does not count against AGT-02 per the verification brief. The adapted discrimination sensor (this is a docs/config-only wave — no test layer exists over prose) confirmed `make lint` (biome) genuinely catches a broken `.claude/settings.json`, and identified two silent-regression classes that nothing in the repo catches.

**One concrete, reproducible defect was found and is not blocking the verdict but is filed as a Fix Plan**: the exact command `.claude/commands/audit.md`, `CLAUDE.md:103` and `.claude/settings.json:22` all document — `pnpm --filter @arch-canvas/repo-tools audit` (without `run`) — fails with exit code 1, `ERROR Unknown option: 'recursive'`, because `audit` collides with pnpm's own built-in `audit` subcommand and the implicit-script shorthand does not fire for names that collide with a builtin. The correct, working invocation is `pnpm --filter @arch-canvas/repo-tools run audit`. This does not falsify AGT-05's literal text (a versioned slash command exists, is well-formed, and IS the mechanism the AC asks for), but it means a first-time agent who follows CLAUDE.md's own line 103 verbatim hits an error on the very first attempt — directly undermining the story's stated goal ("produzir trabalho correto na primeira tentativa"). Recorded as a lesson (L- id below).

---

### Task Completion

| Task (commit) | Status | Notes |
| --- | --- | --- |
| `be76608` — root `CLAUDE.md` | ✅ Done | AGT-01, AGT-03 |
| `62ebacf` — `.claude/settings.json` | ✅ Done | AGT-04 |
| `2b4e6b2` — `/audit` slash command | ✅ Done | AGT-05, but its documented invocation is broken (see Verdict / Fix Plan 1) |
| `c945922` — `/gate` slash command | ✅ Done | AGT-05, verified working (all wrapped `make` targets are real) |

---

### Spec-Anchored Acceptance Criteria

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| **AGT-01** — `CLAUDE.md` na raiz declara comandos de build/teste/stack local, invariantes de arquitetura não-óbvios e armadilhas conhecidas | file exists at repo root, covers all three categories | `CLAUDE.md:29-53` (Comandos: `install`, `lint`, `typecheck`, `test-unit`, `test-integration`, `test-e2e`, `ci`, `up`, `web-dev`, `help`, plus the sandbox trap); `CLAUDE.md:55-88` (Invariantes: AD-003, AD-008, AD-007, AD-001, AD-004, AD-006/009, each with file/module scope); `CLAUDE.md:15-27` and `:49-53` (armadilhas: Node 22 `AbortSignal`, `pg_lsclusters`/`redis-server` ENOENT) | ✅ PASS |
| **AGT-02** — WHEN an agent follows only `CLAUDE.md` THEN it SHALL be able to run lint, typecheck, unit tests, integration tests and the local stack without consulting any other file | each of the 5 documented commands genuinely resolves and (lint/typecheck/unit) genuinely passes; `test-integration`'s failure is the disclosed sandbox trap, not a doc defect | Behavioral check performed live in a fresh shell using only `CLAUDE.md:22-27,33-44`: `eval "$(fnm env)" && fnm use 22 && corepack enable` → Node v22.23.2; `make install` → exit 0 ("Already up to date"); `make lint` → exit 0, 426 files, 4 warnings (all pre-existing — see Gate Check); `make typecheck` → exit 0, 24/24 tasks; `make test-unit` → exit 0, 23/23 tasks; `make test-integration` → exit 1, root cause `spawnSync pg_lsclusters ENOENT`, an exact match for `CLAUDE.md:49-51`'s own disclosed "armadilha conhecida"; `make up` correctly documented as "sobe o stack completo via Docker" against `Makefile:114` (`up: env … $(COMPOSE) up --build -d`) — not executed (no Docker daemon in this sandbox, an environment fact outside AGT-02's own disclosure, not a doc defect) | ✅ PASS |
| **AGT-03** — `CLAUDE.md` SHALL declarar explicitamente a restrição Node 22.x, `corepack enable`, e a proibição de importar `@excalidraw/excalidraw` por valor server-side | all three stated explicitly | `CLAUDE.md:17` ("Este repo trava em **Node 22.x**"); `CLAUDE.md:24` ("`corepack enable` # obrigatório: pnpm só é declarado via packageManager…"); `CLAUDE.md:63-73` (AD-008: "Nenhum pacote que roda no servidor (…) pode importar `@excalidraw/excalidraw` ou `@arch-canvas/editor-adapter` **por valor**") | ✅ PASS |
| **AGT-04** — system SHALL versionar `.claude/settings.json` com permissões de ferramenta e os hooks que o fluxo exige | file tracked in git, valid config, declares permissions + ≥1 hook | `git ls-files .claude/` lists `.claude/settings.json` (tracked); `.gitignore` has no `.claude` entry, `git check-ignore -v .claude/settings.json` → exit 1 (not ignored); `python3 -c "import json; json.load(...)"` → valid JSON; `.claude/settings.json:2-27` (`permissions.allow`, 21 entries); `.claude/settings.json:28-39` (`hooks.SessionStart`, one command hook that warns off-Node-22 sessions) | ✅ PASS |
| **AGT-05** — WHERE a workflow repeats each dev wave, the repo SHALL expose it as a versioned subagent or slash command instead of prose repeated in `tasks.md` | ≥1 such command exists, well-formed, and its wrapped command is real/correct | Two commands exist: `.claude/commands/audit.md:1-4` (valid YAML frontmatter: `description`, `allowed-tools`) and `.claude/commands/gate.md:1-4` (same). `/gate`'s wrapped commands verified real and correct: `make ci`, `make lint`, `make typecheck`, `make test-unit`, `make test-integration` all exist as real `Makefile` targets and were executed live above with the exact behavior `.claude/commands/gate.md:8-14` describes (try `make ci`, fall back to individual steps on the `pg_lsclusters`/`redis-server` `ENOENT`). `/audit`'s wrapped command, run live: `pnpm --filter @arch-canvas/repo-tools audit` → **exit 1**, `ERROR Unknown option: 'recursive'` (pnpm's built-in `audit` subcommand shadows the workspace script of the same name). Corrected form `pnpm --filter @arch-canvas/repo-tools run audit` → exit 0, "wrote docs/route-inventory.md — 82 routes, 4 consumed, 78 pending-product" | ✅ PASS — AC's literal text (mechanism exists, versioned, in lieu of prose) is met; `/audit`'s wrapped invocation is broken as documented, filed as Fix Plan 1, not a criterion failure |

**Status**: ✅ 5/5 ACs covered with `file:line` evidence, 0 fail as written, 0 spec-precision gaps · 1 non-blocking defect filed (Fix Plan 1)

---

### Discrimination Sensor (adapted for a docs-only wave)

No test suite exercises prose or config in this wave — the standard "inject a fault, watch a test die" sensor does not apply as specified. Adapted per the verification brief: for each plausible silent-regression scenario, state plainly whether anything in this repo would actually catch it, verified empirically rather than assumed.

**Isolation**: mutations run against copies in the scratchpad (`/private/tmp/.../scratchpad/sensor/`), never the real tree. Baseline `git status --porcelain` on the real tree: empty, both before and after. No git worktree was used (no test-suite "kill" step exists for docs) and no `git stash` was used, per the brief.

| # | Scenario | Mutation applied | Would anything in this repo catch it? | Verdict |
| --- | --- | --- | --- | --- |
| 1 | Someone edits `CLAUDE.md` and silently removes the Node-22 warning (`CLAUDE.md:17-20`) or the `pg_lsclusters`/`redis-server` disclosure (`:49-53`) | Not applied as a file mutation (prose has no parser to run) — reasoned from repo structure: `make lint` (biome) does not lint Markdown prose content, only formats/lints code and JSON/structured files; no CI job reads `CLAUDE.md` | **No.** Ships silently. `CLAUDE.md` has zero automated guardians — its only protection is the `SessionStart` hook (`.claude/settings.json:29-38`), which independently re-warns on wrong Node version regardless of what the prose says, but does not verify the prose is intact | ❌ Not caught — real gap |
| 2 | Someone breaks `.claude/settings.json`'s JSON syntax (e.g. a stray key with no value) | Applied for real: copied the tracked file to a scratch path, inserted `"BROKEN_TRAILING_COMMA":,` inside the `hooks` object, ran `node_modules/.bin/biome check <scratch-path>` directly | **Yes.** `biome check` parses JSON files (per `biome.json`'s `files.includes: ["**"]`) and `make lint` runs `biome check .` from the repo root, which would traverse `.claude/settings.json` | ✅ Caught — verified live, exit 1, biome reports the exact malformed token and line |
| 3 | Someone edits `.claude/commands/audit.md` or `.claude/commands/gate.md` to reference a command that no longer exists (e.g. renames a `Makefile` target) | Not applied as a mutation — reasoned + partially demonstrated by the pre-existing real bug found in AGT-05 above: the *actual, live* `/audit` command already references a broken invocation form, and nothing failed | **No.** Confirmed by the real-world case in this very wave: `/audit`'s wrapped command has been wrong (missing `run`) since commit `2b4e6b2` and no lint/CI/test step caught it — it was only found by manually executing the command during this verification. Nothing parses or dry-runs slash-command bodies | ❌ Not caught — real gap, and not hypothetical: it already happened |

**Sensor depth**: lightweight, adapted (3 scenarios; 1 of 3 empirically injected as a real file mutation, 2 of 3 reasoned + one corroborated by a genuine pre-existing defect discovered during this same verification pass)
**Result**: 1/3 caught, 2/3 would ship silently — both gaps are inherent to prose/config-only artifacts with no lint/CI surface over their content, not defects introduced by this wave's implementation choices

---

### Code Quality

| Principle | Status |
| --- | --- |
| No features beyond what was asked | ✅ — exactly `CLAUDE.md`, `.claude/settings.json`, two slash commands; nothing else touched |
| No abstractions for single-use code | ✅ — n/a, no code |
| No unnecessary "flexibility" added | ✅ |
| Only touched files required for task | ✅ — `git diff d2e4c6d..HEAD --stat` shows exactly the 4 new files, 183 insertions, 0 deletions, 0 other files touched |
| Didn't "improve" unrelated code | ✅ |
| Matches existing patterns/style | ✅ — slash commands follow the same frontmatter shape (`description` + `allowed-tools`) as commands documented elsewhere in the skill; `settings.json` permission strings follow the `Bash(cmd*)` convention |
| Would senior engineer approve? | ⚠️ — yes, with one real complaint: the `/audit` command and its two other citations were never actually executed before being committed (see Fix Plan 1) |
| Tests map to acceptance criteria and are non-shallow | n/a — no test layer over this wave's artifacts (docs/config only); each AC instead re-verified by direct command execution, documented per-row above |
| Spec-anchored outcome check | ✅ — 5/5 ACs; each `file:line` citation quotes the literal spec-required content, not just "a file exists" |
| Per-layer Coverage Expectation met | n/a — no domain logic or routes in this wave's diff |
| Every test in scope maps to a spec AC / edge case / Done-when (no unclaimed tests) | n/a — no tests in scope |
| Documented project quality/testing guidelines followed | `CLAUDE.md` itself (this wave's own deliverable) + `.claude/skills/tlc-spec-driven/references/validate.md` — both followed |

---

### Edge Cases

General "Edge Cases" section of `spec.md` (lines 178-183) — checked against F7's scope:

- [ ] Capability map → removed UI component: **n/a** — TRU/UIX domain (F6), not F7
- [ ] Healthcheck flapping: **n/a** — CIQ domain (F6), not F7
- [ ] MCP cross-workspace token: **n/a** — MCP domain (F9), not F7
- [ ] Empty OpenAPI document: **n/a** — API domain (F8), not F7
- [ ] `STATE.md` merge across squads: **n/a** — GOV domain (F8), not F7
- [ ] New package with no coverage floor: **n/a** — CIQ domain (F6, already gated), not F7

None of the general edge cases apply to F7's scope (`CLAUDE.md`, `.claude/`) — confirmed explicitly rather than silently skipped. F7's user story (line 108) does not enumerate its own edge cases in `spec.md`.

---

### Gate Check

- **Gate command**: no `tasks.md` exists for F7, so no declared "Build gate command" — used `.claude/commands/gate.md`'s own documented sequence (`make ci`, falling back to `make lint && make typecheck && make test-unit` on the disclosed `pg_lsclusters`/`redis-server` `ENOENT`), matching the same substitution the F6 report above used.
- **Node**: v22.23.2, via `fnm use 22 && corepack enable` (fnm was available in this environment; the sandbox default `node -v` is v24.9.0, confirming the Node-22 restriction is load-bearing, not decorative).

| Step | Result |
| --- | --- |
| `make install` | ✅ exit 0 — "Lockfile is up to date… Already up to date" |
| `make lint` | ✅ exit 0 — 426 files checked, 0 errors, 4 warnings, all pre-existing (`tools/repo-tools/src/webConsumers.spec.ts` — `noTemplateCurlyInString`, a file untouched by this wave's diff; same 4 warnings the F6 report recorded above) — **no new warnings introduced by this wave** |
| `make typecheck` | ✅ exit 0 — 24/24 tasks successful (Turbo, cache hits) |
| `make test-unit` | ✅ exit 0 — 23/23 tasks successful; `apps/web` reports 28/28 tests passed, other packages cache-hit at their prior green state |
| `make test-integration` | ❌ exit 1 — root cause confirmed as `spawnSync pg_lsclusters ENOENT` (`@arch-canvas/backup`), an exact, verified match for `CLAUDE.md:49-51`'s own disclosed "armadilha conhecida deste ambiente sandbox". Per the verification brief, this specific, disclosed failure does not count against AGT-02 |
| `pnpm --filter @arch-canvas/repo-tools run audit` | ✅ exit 0 — "wrote docs/route-inventory.md — 82 routes, 4 consumed, 78 pending-product" (regenerated byte-identical, matching F6's numbers — confirms this wave did not disturb F6's gate) |

**Test count before/after this wave**: unchanged — this wave adds zero test files (confirmed by `git diff d2e4c6d..HEAD --stat` above: only `.md`/`.json` files). No test integrity concern applies.

---

### Fix Plans

#### Fix 1: `/audit`'s documented command is broken as written

- **Root cause**: `pnpm --filter @arch-canvas/repo-tools audit` (no `run`) is intercepted by pnpm's own built-in `audit` subcommand (dependency vulnerability audit) instead of the workspace's `audit` script (`tools/repo-tools/package.json`'s `"audit": "node dist/cli.js audit"`), because pnpm's implicit-script shorthand does not fire for script names that collide with a built-in command name. Verified live: `pnpm --filter @arch-canvas/repo-tools audit` → exit 1, `ERROR Unknown option: 'recursive'`; `pnpm --filter @arch-canvas/repo-tools run audit` → exit 0.
- **Where**: `CLAUDE.md:103`, `.claude/commands/audit.md:4` (the `allowed-tools` frontmatter) and `:8` (step 1), `.claude/settings.json:22` (the pre-approved permission string — also needs the `run` form to actually pre-approve the command that works).
- **Fix task**: In all three files, change `pnpm --filter @arch-canvas/repo-tools audit` to `pnpm --filter @arch-canvas/repo-tools run audit`.
- **Verify**: run the corrected command; confirm exit 0 and the "wrote docs/route-inventory.md — N routes…" line.
- **Done when**: all three citations use the `run` form, and executing `/audit` end-to-end (or the raw command) exits 0 on a clean tree.
- **Priority**: Major (silent-on-first-attempt failure of the wave's own onboarding promise, though loud once run — not a security or data-integrity issue).

---

### Requirement Traceability Update

| Requirement | Previous | New |
| --- | --- | --- |
| AGT-01 | Pending | ✅ Verified |
| AGT-02 | Pending | ✅ Verified (behavioral check performed live; `test-integration`'s failure is the disclosed sandbox trap, not a doc defect) |
| AGT-03 | Pending | ✅ Verified |
| AGT-04 | Pending | ✅ Verified |
| AGT-05 | Pending | ✅ Verified (mechanism correct; wrapped `/audit` invocation has a documented-but-broken command, filed as Fix Plan 1 — non-blocking, does not falsify the AC's literal text) |

---

### Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 5/5 ACs covered with `file:line` evidence · 0 fail as written · 0 spec-precision gaps
**Sensor (adapted)**: 3 silent-regression scenarios examined — 1 caught (broken `.claude/settings.json` JSON, verified live via biome) · 2 would ship silently (stale/wrong prose in `CLAUDE.md` or a command file — one of which is not hypothetical: it already happened, see Fix Plan 1)
**Gate**: `make lint` ✅ (426 files, 0 errors, 4 pre-existing warnings) · `make typecheck` ✅ (24/24) · `make test-unit` ✅ (23/23) · `make test-integration` ❌ on the pre-existing, `CLAUDE.md`-disclosed sandbox limitation (not counted against AGT-02 per the verification brief) · `repo-tools run audit` ✅ (82/4/78, matches F6)

**What works**: `CLAUDE.md` is genuinely sufficient on its own to get a fresh agent from a wrong-Node-version shell to green `lint`/`typecheck`/`test-unit` — every command in it was executed verbatim in this pass and behaved exactly as documented, including correctly disclosing its own known failure mode (`pg_lsclusters`/`redis-server` ENOENT) before that failure was even reproduced. The Node-22 restriction, `corepack enable` requirement, and the AD-008 Excalidraw-by-value ban are all stated explicitly with the right technical rationale. `.claude/settings.json` is tracked, valid, and carries both a real permission allowlist and a working `SessionStart` hook. `/gate` is fully accurate. The `4 + 78 = 82` numbers regenerated by `/audit`'s corrected form match F6's report exactly, confirming this wave did not silently disturb prior work.

**Issues found**: `/audit`'s documented invocation (`CLAUDE.md:103`, `.claude/commands/audit.md:4,8`, `.claude/settings.json:22`) is broken — it needs `run` before `audit` to avoid colliding with pnpm's built-in `audit` command. Non-blocking (Fix Plan 1, Major). Two structural gaps, inherent to any prose/config-only onboarding artifact rather than specific to this wave's execution: nothing lints `CLAUDE.md`'s prose content, and nothing dry-runs slash-command bodies — both distilled as lessons below.

**Next steps**: apply Fix Plan 1 (three-file, one-word-per-file change) in a follow-up commit; no re-verification round needed given its non-blocking severity and trivial fix. No other action required to close F7.

---

## F8 Wave Report (Governança e contrato) — PASS ✅

**Current, authoritative verdict** for wave F8, as of round 2 (2026-08-16). Round 1 below (originally FAIL ❌) is preserved as historical record — its 9/9 AC findings and 3/3-killed sensor result, once real, do not stop being true, and its one blocking gap (the `functions` coverage-floor regression, Fix Plan 1) is resolved in `### Re-Verification — Round 2 (Gate Check only)` at the end of this section, which carries the full evidence for the PASS verdict: the Gate Check (`server test:unit`, `make lint`, `make typecheck`, `make test-unit`) is green end to end, and the fix (lowering the `functions` ratchet to the genuinely measured 28.87%, with `lines`/`branches`/`statements` untouched) was independently re-derived, not just read off the commit message.

**Round 1 report follows, unchanged**:

**Date**: 2026-08-16
**Spec**: `.specs/features/platform-maturity/spec.md` (P2 stories "Governança para múltiplos squads" and "Contrato de API para consumo automatizado", lines 143-172)
**Diff range**: `a55c4d7..HEAD` (40 commits; `git diff a55c4d7..HEAD --stat` — 49 files, +5705/-725)
**Verifier**: independent sub-agent (author ≠ verifier)

**Headline**: all 9 acceptance criteria (GOV-01..06, API-01..03) are independently re-verified with `file:line` evidence and PASS on their own literal text — the OpenAPI generator, the CI parity/threshold gates, and all 6 governance deliverables are real, correct, and match the spec. **The wave is marked FAIL because the mandatory Gate Check itself fails**: `pnpm --filter @arch-canvas/server run test:unit` exits 1 on the coverage floor for `functions` (28.87% measured vs. 39.73% locked ratchet), and this is a **real regression introduced by this wave**, not the pre-existing/unrelated condition `tasks.md`'s T26 note claims. This was independently disproven by running the exact same command against a scratch `git worktree` checked out at `a55c4d7` (the true start of F8, before any of its 40 commits) — that baseline measures **39.73% functions, exactly the locked floor, exit 0** — versus HEAD's confirmed **28.87%, exit 1**. The task's own claim was based on isolating only the last 2 files of the wave (`threshold.ts`/`threshold.spec.ts`) via `git stash`, comparing against an already-40-commits-deep intermediate state, not the wave's actual starting point. See Gate Check and Fix Plan 1 below for the full root-cause trace.

---

### Task Completion

All 35 tasks (T1-T35) in `tasks.md` are checked `[x]` with individual "Done when" evidence per task. One apparent gap on inspection — 4 unchecked `- [ ]` boxes at `tasks.md:363-366` — is the shared **template** checklist printed once before the T21/T22/T23 batch (`**Done when** (cada task):`), not a real per-task tracker; the actual per-task instances immediately below it (`**T21 (core)**:`, `**T22 (presentation-publish)**:`, `**T23 (workspace-project-diagram)**:`, `tasks.md:368-384`) are all `[x]`. Confirmed not a completion gap.

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1-T4 | ✅ Done | OpenAPI foundation (`types.ts`, `buildDocument.ts`, `registry.ts`, `generate.ts`) |
| T5-T20 | ✅ Done | `routeSchemas` export in all 16 `routes.ts` modules (batches 1-3) |
| T21-T23 | ✅ Done | Phase 2d — the 3 non-`routes.ts`-named route files (`core/server.ts`, `presentation/publishRoutes.ts`, `workspace/project-diagram-routes.ts`), added mid-execution after Batch 1 found the naming-convention gap |
| T24-T25 | ✅ Done | `checkOpenApiParity` (repo-tools) + CI wiring into `capability-audit` |
| T26-T28 | ✅ Done | `checkEvalThreshold`, `runThresholdCheck.ts`, dedicated `ai-evals` CI job |
| T29-T35 | ✅ Done | `CODEOWNERS`, PR template, Changesets config + CI gate, ADR template, GOV-04 note, `STATE.md` Handoffs restructure |

---

### Spec-Anchored Acceptance Criteria

#### P2: Governança para múltiplos squads (spec.md:143-158)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| GOV-01: ownership de cada domínio de primeiro nível em `CODEOWNERS`, sem nenhum domínio sem dono | Todo domínio de primeiro nível (server, packages, infra, web + os demais do monorepo) tem uma linha de dono | `CODEOWNERS:7-13` — 7 domínios (`/apps/server/`, `/apps/web/`, `/packages/`, `/infra/`, `/.github/`, `/docs/`, `/.specs/`), cada um com `@tvpl` (único colaborador real, decisão registrada em `spec.md`'s Assumptions table) | ✅ PASS |
| GOV-02: template de PR exige IDs de requisito e link para spec | Campos obrigatórios presentes no template | `.github/PULL_REQUEST_TEMPLATE.md:5-11` — seção `## Requirement IDs (required)` + seção `## Spec link` | ✅ PASS |
| GOV-03: PR que altera package publicável sem changeset falha no CI nomeando o package | O job falha citando o nome exato do package alterado sem changeset | `.github/workflows/ci.yaml:63-115` (`changeset-check` job); comportamento verificado ao vivo — ver Gate Check § GOV-03 abaixo (real historical range `2606a2e..015b5c6` correctly fails naming `@arch-canvas/diagram-ir`; a crafted changeset makes the identical logic pass) | ✅ PASS |
| GOV-04: `.specs/features/` mantém uma spec por domínio em vez de spec monolítica | Convenção documentada + exemplar real existente | `CLAUDE.md:99-101` — "Convenção em uso desde F6: uma spec por domínio... exemplar real: `.specs/features/ai-dock/spec.md`"; confirmed `.specs/features/ai-dock/spec.md` exists with its own `DOCK-NNN` requirement prefix (`ai-dock/spec.md:154`) | ✅ PASS |
| GOV-05: nova decisão arquitetural registrada como ADR no mesmo formato de ADR-0001..0009 | Template extrai o formato real já em uso (Status/Contexto/Decisão/Consequências) | `docs/adr/TEMPLATE.md:1-24` — structure verified to match `docs/adr/0009-pluggable-presence-broadcaster.md:1-10` (Status/Data/Contexto/Decisão/Consequências) exactly | ✅ PASS |
| GOV-06: `STATE.md` handoff por frente (não um único snapshot global) enquanto ≥2 frentes ativas | `## Handoffs` (plural) com subseção `### <feature-slug> (branch: ...)` por frente | `.specs/STATE.md:77-82` — `## Handoffs` heading + `### platform-maturity (branch: feature/improvements-2)` subsection; correctly does NOT prematurely claim F8 verified (`STATE.md:86`: "O Verifier independente de F8 ainda não rodou... não reivindicar F8 como verificado/fechado até ele reportar PASS") — corrected post-verification, see note below | ✅ PASS |

#### P2: Contrato de API para consumo automatizado (spec.md:161-172)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| API-01: OpenAPI 3.1 gerado dos schemas Zod, cobrindo toda rota REST registrada | Documento cobre as 82 rotas reais, nenhuma faltando ou sobrando | `apps/server/src/openapi/buildDocument.ts:119-146` (`buildOpenApiDocument`); `apps/server/src/openapi/registry.ts:28-49` (20-module registry, includes the 3 Phase-2d files); **independently recounted** — a from-scratch Python re-scan of `apps/server/src` (whole tree, `*.spec.ts` excluded, multi-line-aware regex matching the real `ROUTE_PATTERN`) totals exactly **82** routes, matching `docs/openapi.json`'s 82 operations (61 paths) and `docs/route-inventory.md`'s `4 consumed + 78 pending-product = 82`; `pnpm --filter @arch-canvas/repo-tools run audit` exits 0 with zero `checkOpenApiParity` violations reported | ✅ PASS |
| API-02: rota adicionada/alterada sem regenerar o documento faz o CI falhar apontando a rota divergente | CI step regenerates and diffs the doc, failing on divergence | `.github/workflows/ci.yaml:347-360` (`capability-audit` job: `make openapi` → `biome format` → `git diff --exit-code docs/openapi.json` → `run audit`); reproduced live: `make openapi` + `pnpm exec biome format --write docs/openapi.json` + `git diff --exit-code docs/openapi.json` exits 0 (doc genuinely up to date) | ✅ PASS |
| API-03: suíte de evals do `ai-engine` falha o build se a taxa de sucesso ficar abaixo do limiar declarado | Threshold check fails build below declared rate; passes at/above it | `apps/server/src/modules/ai-engine/evals/threshold.ts:29-41` (`checkEvalThreshold`, `EVAL_SUCCESS_THRESHOLD = 1.0`); `apps/server/src/modules/ai-engine/evals/runThresholdCheck.ts` wired into `.github/workflows/ci.yaml:144-160` (`ai-evals` job); reproduced live: `pnpm exec tsx src/modules/ai-engine/evals/runThresholdCheck.ts` (from `apps/server`) → `5/5 evals passed, limiar 100%`, exit 0. Real case count is **5**, not the "10" `design.md:54` and `tasks.md:463-466` state — a genuinely stale prose fact, already caught and disclosed in `tasks.md:474` during implementation (`evals.spec.ts`'s own header already documents only 5/11 product-spec.md §8.6 cases are in this batch's built scope) — confirmed here as a real, harmless doc inaccuracy, not a checker defect | ✅ PASS (⚠️ disclosed spec-precision gap in `design.md`/`tasks.md` prose, not in the AC itself) |

**Status**: ✅ All 9 ACs covered with `file:line` evidence, 0 unevidenced, 1 disclosed prose-only spec-precision gap (API-03's "10 vs 5", non-blocking) — **but see the Gate Check FAIL below, which blocks the wave regardless of AC-level correctness.**

---

### Discrimination Sensor

Isolated in a scratch `git worktree` at HEAD (`git worktree add`, never `git stash`); real tree's `git status --porcelain` confirmed empty before and after; worktree removed with `git worktree remove --force` after each mutation.

| Mutation | File:line | Description | Killed? |
| --- | --- | --- | --- |
| 1 | `apps/server/src/openapi/buildDocument.ts:135` | `if (routeCount === 0)` → `if (routeCount < 0)` (empty-registry guard neutered) | ✅ Killed — `buildDocument.spec.ts`'s "throws citing the empty registry" test fails as expected |
| 2 | `tools/repo-tools/src/openApiParity.ts:102` | `if (!documented.has(key))` → `if (documented.has(key))` (inverted — flags every documented route as missing instead of undocumented ones) | ✅ Killed — 2/2 `openApiParity.spec.ts` tests fail (false violations reported / real violations missed) |
| 3 | `apps/server/src/modules/ai-engine/evals/threshold.ts:40` | `rate >= threshold` → `rate > threshold` (100% pass rate at 100% threshold now reports `ok: false`) | ✅ Killed — `threshold.spec.ts`'s "reports ok: true... at the 100% threshold" test fails as expected |

**Sensor depth**: lightweight (1 mutation each on `buildOpenApiDocument`, `checkOpenApiParity`, `checkEvalThreshold` — non-P0 surfaces per the brief)
**Result**: 3/3 killed — PASS ✅

---

### Code Quality

Spot-checked 3 of the 20 `routeSchemas` modules by reading the full `routes.ts`/route file and diffing every real route against its `routeSchemas` entry by hand (method, path, params/query/body schema reference):

- `apps/server/src/modules/share/routes.ts` (T10) — 4 real routes (`POST /diagrams/:id/share-links`, `POST /presentations/:id/share-links`, `GET /share/:token`, `POST /share-links/:id(^[^:]+):revoke`) vs. `routeSchemas:47-58` — exact match, correct params/body schema references, no extras, no omissions.
- `apps/server/src/modules/workspace/project-diagram-routes.ts` (T23) — 10 real routes (`GET`/`POST /projects`, `GET`/`PATCH`/`DELETE /projects/:id`, `GET`/`POST /diagrams`, `GET`/`PATCH`/`DELETE /diagrams/:id`) vs. `routeSchemas:86-97` — exact match.
- `apps/server/src/modules/workspace/routes.ts` (T6) — 9 real routes vs. `routeSchemas` — exact match, correctly excludes the project/diagram routes that live in the separate `project-diagram-routes.ts` file (T23), avoiding a duplicate/colliding registry key.

| Principle | Status |
| --- | --- |
| No features beyond what was asked | ✅ |
| No abstractions for single-use code | ✅ — `RouteSchemaMap` is genuinely reused across 20 modules |
| No unnecessary "flexibility" added | ✅ |
| Only touched files required for task | ✅ — diff stat matches exactly the 20 route files + `openapi/*` + `evals/*` + governance files + CI/docs |
| Didn't "improve" unrelated code | ✅ |
| Matches existing patterns/style | ✅ — every `routeSchemas` export follows the identical shape and JSDoc pattern across all 20 modules |
| Would senior engineer approve? | ⚠️ — yes for the AC-level work itself, but not without pushback on the T26 self-report (see Fix Plan 1) — a coverage-floor claim was asserted as "confirmed" from a `git stash` isolation that did not actually isolate the whole wave |
| Tests map to acceptance criteria and are non-shallow | ✅ — `buildDocument.spec.ts` (7 tests), `openApiParity.spec.ts` (4 tests), `threshold.spec.ts` (4 tests), `runThresholdCheck.spec.ts` (2 tests), `registry.spec.ts` (1 test) all target real branch behavior, confirmed via the discrimination sensor above |
| Spec-anchored outcome check | ✅ — all 9 AC assertions above target the literal spec outcome, not just "a file exists" |
| Per-layer Coverage Expectation met | ✅ for the new `openapi`/`evals` domain logic (near-1:1, confirmed by sensor); ❌ for the wave's net effect on the pre-existing global `functions` ratchet (see Gate Check) |
| Every test in scope maps to a spec AC / edge case / Done-when (no unclaimed tests) | ✅ |
| Documented project quality/testing guidelines followed | `coding-principles.md` + `.specs/features/platform-maturity/tasks.md`'s own "Gate Check Commands" table — both followed for individual tasks; the wave-level coverage-floor claim in `tasks.md:453` (T26) is the one place a documented verification step (isolate-and-compare) was performed incorrectly (see Fix Plan 1) |

---

### Edge Cases

From `spec.md`'s general Edge Cases section (lines 176-183), checked against F8's scope:

- [x] "IF a geração do OpenAPI produzir um documento sem nenhuma rota THEN o CI SHALL falhar": `buildOpenApiDocument` throws on an empty registry (`buildDocument.ts:135-139`, sensor-confirmed killed above); `checkOpenApiParity` separately treats a missing/unparseable/route-less `docs/openapi.json` as a violation on its own (`openApiParity.ts:65-91`, tested at `openApiParity.spec.ts:74`) — both layers covered
- [x] "WHEN dois squads editarem STATE.md na mesma janela THEN o formato por frente SHALL permitir merge sem perda de contexto": `STATE.md:77-82`'s `## Handoffs` + per-feature `###` subsection format is in place; only 1 real front exists today so N-front merge itself is unexercised, but the structural mechanism (independent Markdown subsections, no shared mutable block) is present as designed
- [ ] n/a — MCP cross-workspace token: F9 scope, not F8
- [ ] n/a — healthcheck flapping: F6/CIQ scope, not F8
- [ ] n/a — capability map pointing at removed UI component: F6/TRU scope, not F8
- [ ] n/a — new package with no coverage floor: F6/CIQ-04 scope, not F8 (though see Gate Check — this wave regresses an *existing* floor, a different failure mode than "no floor declared")

---

### Gate Check

- **Gate command**: Full level (`tasks.md`'s Gate Check Commands table — "tasks touching CI wiring or cross-package behavior") = `make lint && make typecheck && make test-unit`; also ran the Quick-level per-package commands for `@arch-canvas/repo-tools` and `@arch-canvas/server` directly.
- **Node**: v22.23.2 via `fnm use 22 && corepack enable` (confirmed load-bearing, matches `CLAUDE.md`'s documented constraint).

| Step | Result |
| --- | --- |
| `make lint` | ✅ exit 0 — 440 files checked, 0 errors, 4 pre-existing warnings (`tools/repo-tools/src/webConsumers.spec.ts`, untouched by this wave — same warnings F6/F7 reports already recorded) |
| `make typecheck` | ✅ exit 0 — 24/24 tasks successful (Turbo) |
| `pnpm --filter @arch-canvas/repo-tools run test:unit` | ✅ exit 0 — 49/49 tests passed (7 files, incl. `openApiParity.spec.ts`'s 4 new tests) |
| `pnpm --filter @arch-canvas/repo-tools run audit` (note: `run`, not bare `audit` — bare form reproduced the documented `ERROR Unknown option: 'recursive'` collision with pnpm's builtin, confirming L-022 is still live) | ✅ exit 0 — "82 routes, 4 consumed, 78 pending-product", zero parity/floor/capability violations |
| `pnpm --filter @arch-canvas/server run test:unit` | ❌ **exit 1** — 380/380 individual tests PASS (36/36 files), but the run fails on `ERROR: Coverage for functions (28.87%) does not meet global threshold (39.73%)` (`apps/server/vitest.config.ts:26`, CIQ-04's locked ratchet from F6) |
| `make test-unit` (all packages) | ❌ exit 1 — 22/23 Turbo tasks successful; the single failure is `@arch-canvas/server#test:unit`, same coverage-floor error as above |

**Root-cause investigation (this is the wave's central finding)**: `tasks.md:453` (T26) claims this coverage-floor failure "já estava quebrado (28.67%) ANTES deste arquivo existir (confirmado isolando `threshold.ts`/`threshold.spec.ts` via `git stash`)" and is therefore pre-existing and out of scope. **This claim does not hold up under independent re-verification**:

1. Created a scratch `git worktree` at `a55c4d7` (the actual commit immediately preceding F8's first commit — the wave's true starting point, not an intermediate state).
2. `pnpm install --frozen-lockfile` + `make build` in that worktree (fast — pnpm content-addressable store), then `pnpm --filter @arch-canvas/server run test:unit --coverage.reporter=json-summary`.
3. Result: **360/360 tests pass, exit 0, `functions: 39.73%`** — exactly matching the floor value hard-coded in `vitest.config.ts:26`, confirming that value was calibrated against this exact pre-F8 state. Reproduced twice, byte-identical both times.
4. Same command on HEAD (real tree): **380/380 tests pass, exit 1, `functions: 28.87%`**.
5. Diffed the two runs' `coverage-summary.json` per-file function totals (not just the human-truncated console table). Finding: **every one of ~30 `routes.ts`/business-logic files across nearly every module (`share`, `webhook`, `ai-provider`, `export`, `auth`, `comment`, `asset`, `presentation`, `ws-gateway`, `lint`, `ai-engine`, `docgen`, `interop`, `diagram-sync`, `library`, `workspace`, ...) jumped from "1 total function, 0 covered" (pre-F8) to "N total functions (3-9), 0 covered" (HEAD)** — same real functions, now correctly counted by V8's coverage instrumentation where they previously collapsed into a single reported unit. Aggregate: **total functions denominator rose from 302 (pre-F8) to 426 (HEAD, +124)**, while covered functions barely moved (120 → 123, from this wave's own new, well-tested `openapi`/`evals` code). This directly and reproducibly drags the global `functions` percentage from 39.73% to 28.87% — a genuine, wave-caused change in what gets measured, not a pre-existing condition and not something F8 "nudges up."
6. Cleanup verified: both scratch worktrees removed with `git worktree remove --force`; `git status --porcelain` on the real tree confirmed empty before and after every step in this investigation.

**Test count before/after this wave**: 360 → 380 (+20 new tests, all passing) — matches the 5 new spec files (`buildDocument.spec.ts` 7, `openApiParity.spec.ts` 4, `registry.spec.ts` 1, `threshold.spec.ts` 4, `runThresholdCheck.spec.ts` 2 = 18... plus `cli.spec.ts` gained the `OPENAPI_DOC` fixture wiring, accounting for the remainder). No test-count regression; the failure is purely the coverage-floor gate, not the tests themselves.

---

### Fix Plans

#### Fix 1 (Blocker): `functions` coverage floor regression, mis-classified as pre-existing

- **Root cause**: Adding `routeSchemas` exports (and the `import type { RouteSchemaMap }` that comes with them) across ~20 route files changed how V8's coverage instrumentation attributes functions within those files — functions that already existed (route handler closures, business-logic helpers) were previously being collapsed into a single "1 function" unit per file under coverage and are now counted individually, all still at 0% coverage. This raised the wave-wide `functions` denominator from 302 to 426 without a matching rise in covered functions, dragging the aggregate below the CIQ-04 ratchet locked in `apps/server/vitest.config.ts:26` (39.73%). `tasks.md:453`'s self-report incorrectly attributed this to a pre-existing condition, because its isolation method (`git stash` of only the last 2 files) compared against an already-38-commits-deep intermediate state of the wave, not the wave's actual starting point.
- **Where**: `apps/server/vitest.config.ts:26` (the locked threshold) vs. the ~20 modified `routes.ts`/route files across `apps/server/src/modules/*` and `apps/server/src/core/server.ts`; the false claim itself is at `.specs/features/platform-maturity/tasks.md:453`.
- **Fix task**: Either (a) add unit tests directly exercising a representative sample of the now-newly-counted, previously-uninstrumented functions until `functions` coverage clears 39.73% again, or (b) if the team judges the new, more-accurate function count doesn't warrant closing that gap in this wave, deliberately edit the ratchet in `vitest.config.ts` down to the new measured value with an explicit justification comment (CIQ-04's own rule: "Lowering any of them requires editing this file on purpose — no threshold is inherited implicitly"), and correct `tasks.md:453`'s note to stop citing this as pre-existing/unrelated.
- **Verify**: `pnpm --filter @arch-canvas/server run test:unit` exits 0.
- **Done when**: the Full gate (`make lint && make typecheck && make test-unit`) exits 0 end to end, and `tasks.md:453`'s note is corrected to reflect the real root cause (or removed if the threshold is deliberately adjusted instead).
- **Priority**: **Blocker** — this is not cosmetic; it means the branch as it stands would turn the `unit` CI job red on any real pull request, exactly the failure mode CIQ-04 exists to prevent, caused by this wave's own diff.

---

### Requirement Traceability Update

| Requirement | Previous | New |
| --- | --- | --- |
| GOV-01 | Pending | ✅ Verified |
| GOV-02 | Pending | ✅ Verified |
| GOV-03 | Pending | ✅ Verified |
| GOV-04 | Pending | ✅ Verified |
| GOV-05 | Pending | ✅ Verified |
| GOV-06 | Pending | ✅ Verified |
| API-01 | Pending | ✅ Verified |
| API-02 | Pending | ✅ Verified |
| API-03 | Pending | ✅ Verified |

All 9 ACs are individually grounded and correct on their literal text — none is downgraded to "Needs Fix" on its own merits. The wave's blocking gap (Fix Plan 1) is a regression against **CIQ-04** (an F6 requirement, already `✅ Verified` in that wave's own report) rather than a failure of any GOV/API criterion's literal wording — but it is real, it is caused by this wave's diff, and it must close before F8 can be considered mergeable/done. `STATE.md`'s Handoffs section is updated accordingly (see below) to stop pointing at "Verifier pendente" and instead record the actual FAIL verdict and its one blocking fix task.

---

### Summary

**Overall**: ⚠️ Issues (not ❌ Not Ready — the gap is single, well-understood, and one fix task away; not ✅ Ready — the Gate Check genuinely fails today)

**Spec-anchored check**: 9/9 ACs matched spec outcome with `file:line` evidence · 1 disclosed prose-only spec-precision gap (API-03, "10 vs 5" in `design.md`/`tasks.md`, non-blocking, already caught by the implementer)
**Sensor**: 3/3 mutations killed (lightweight tier, `buildOpenApiDocument`, `checkOpenApiParity`, `checkEvalThreshold`)
**Gate**: `make lint` ✅ · `make typecheck` ✅ · `repo-tools test:unit` ✅ (49/49) · `repo-tools run audit` ✅ (82/4/78) · `server test:unit` ❌ (380/380 individual tests pass, but exit 1 on the `functions` coverage floor — confirmed wave-caused, not pre-existing) · `make test-unit` ❌ (22/23 Turbo tasks; same single failure)

**What works**: The OpenAPI generation pipeline is real and correct — `z.toJSONSchema()`-based conversion, 20-module registry (including the 3 non-`routes.ts`-named files the Phase 2d mid-wave correction added), zero parity violations against an independently recounted 82-route reality, empty-document guard rail, CI regeneration+diff gate all verified by direct execution, not just reading YAML. The evals threshold checker is correct and honest about the real 5/5 case count. All 6 governance deliverables (`CODEOWNERS`, PR template, Changesets + CI gate, ADR template, GOV-04 note, `STATE.md` Handoffs) are genuine, correctly scoped, and (for `changeset-check`) empirically proven correct against both a real historical no-changeset commit range and a crafted passing case — not merely read and assumed.

**Issues found**: The wave's own `tasks.md:453` self-report incorrectly classified a coverage-floor regression as pre-existing/unrelated based on an isolation method that didn't actually isolate the whole wave (`git stash` of the last 2 files instead of a true pre-wave baseline). Independent re-verification via a proper `git worktree` baseline at `a55c4d7` shows the regression is real and wave-caused (39.73%→28.87% functions coverage, exit 0→1). This is Fix Plan 1 (Blocker).

**Next steps**: Land Fix Plan 1 (either raise coverage on the newly-visible functions, or deliberately and transparently lower the ratchet with justification), correct `tasks.md:453`'s note, re-run `pnpm --filter @arch-canvas/server run test:unit` to confirm exit 0, then re-run this Verifier's Gate Check step only (no need to redo the AC/sensor/quality checks, which are unaffected) before F8 can be marked fully closed.

---

### Re-Verification — Round 2 (Gate Check only)

**Date**: 2026-08-16
**Verifier**: independent sub-agent, round 2 (author ≠ verifier; a different session from both round 1's verifier and from the fix's author)
**Scope**: narrow, per round 1's own stated next steps — only the Gate Check is re-run here. The 9 ACs (GOV-01..06, API-01..03), the discrimination sensor (3/3 killed), and the Code Quality check are unaffected by Fix Plan 1 and are **not** redone in this round; round 1's findings for those sections stand unchanged and are not repeated below.

**Fix applied**: commit `ba20552` ("fix(server): recalibrate the functions coverage ratchet after F8"), landed on top of `a389a33` (which recorded round 1's FAIL). `git diff a389a33..HEAD --stat` confirms the fix touches exactly the 2 files Fix Plan 1 named — `apps/server/vitest.config.ts` (+17/-2) and `.specs/features/platform-maturity/tasks.md` (+1/-1) — nothing else, and the real tree's `git status --porcelain` is empty (no stray uncommitted state from the fix).

#### Gate Check — re-run

Node: v22.23.2 (`eval "$(fnm env)" && fnm use 22 && corepack enable`).

| Step | Result |
| --- | --- |
| `pnpm --filter @arch-canvas/server run test:unit` | ✅ exit 0 — **380/380 tests passed** (36/36 files); `functions` coverage measured **28.87%** on this fresh, uncached run, exactly matching the new floor |
| `make lint` | ✅ exit 0 — 440 files checked, 0 errors, 4 pre-existing warnings (same `webConsumers.spec.ts` `noTemplateCurlyInString` warnings recorded in every prior wave report — no new warnings introduced) |
| `make typecheck` | ✅ exit 0 — 24/24 Turbo tasks successful |
| `make test-unit` (all packages) | ✅ exit 0 — 23/23 Turbo tasks successful |

The Gate Check that blocked round 1 is now green end to end.

#### Is the fix legitimate, or a cheat?

Checked deliberately skeptically, per the verification brief — a lowered ratchet is exactly the kind of change that is easy to over-apply "for safety."

1. **The value genuinely matches a real measurement, not just the comment's claim.** The fresh, uncached `pnpm --filter @arch-canvas/server run test:unit` run above measured `functions: 28.87%` — the exact same number now hard-coded as the floor at `vitest.config.ts:42`. The floor is set *at* the measured value, not below it with a safety margin. Corroboration: round 1 independently measured 28.87% off a `git worktree` baseline before this fix existed, and that number matches to two decimal places.
2. **`lines`/`branches`/`statements` were not quietly lowered too.** `git show ba20552 -- apps/server/vitest.config.ts` shows only the `functions:` value changed (`39.73` → `28.87`); `lines: 25.48`, `branches: 80.27`, and `statements: 25.48` are byte-identical before and after the commit — confirmed by reading the diff directly, not by trusting the commit message. No other threshold moved.
3. **The justification comment is accurate, not decorative.** `vitest.config.ts:19-36`'s new comment states the real root cause (V8 now counts previously-collapsed handler closures individually across the ~20 `routeSchemas`-exporting route files, raising the functions denominator from 302 to 426 with no matching rise in covered functions) and explicitly notes `lines`/`branches`/`statements` all measured *higher* on this same diff — only `functions` regressed. This matches round 1's own independently-derived root-cause finding, not a new or convenient story invented by the fix.
4. **`tasks.md`'s T26 note is corrected, not merely softened.** `tasks.md:453` no longer claims the regression is pre-existing; it now explicitly attributes it to F8, names the `git stash`-vs-38-commits-deep isolation flaw round 1 found, and points to `validation.md`'s Fix Plan 1.

**Legitimate.** This is exactly Fix Plan 1's option (b) — a deliberate, justified, on-purpose lowering of one specific ratchet to the real measured value, with the false "pre-existing" claim corrected — not an inflated safety margin and not a quiet multi-threshold rollback.

#### Incidental finding (non-blocking, outside this round's mandate)

`tasks.md:476` (T27's "Done when" note) still reads "...o comando sai 1 só pelo mesmo piso de cobertura global pré-existente já registrado na nota de T26" — this is now stale: the gate exits 0, not 1, and the T26 note it points to no longer says "pré-existente." T27's note was not part of Fix Plan 1's named scope (only T26's note was), so it was not touched by the applied fix. Cosmetic — T27's checkbox is still correctly `[x]` and the claim doesn't affect any AC, gate result, or the traceability table — but worth a one-line cleanup alongside T26's for consistency. Flagged for the orchestrator; not blocking this verdict.

#### State validator

`python3 .claude/skills/tlc-spec-driven/scripts/validate_state.py platform-maturity` → exit 0.

#### Verdict — Round 2

**Overall F8 wave**: ✅ **PASS** (flipped from round 1's ⚠️ Issues/FAIL-on-gate). All 9 ACs remain individually `✅ Verified` (unchanged from round 1; re-confirmed here only in the sense that the passing gate now backs them), the sensor's 3/3-killed result stands as round 1 recorded it, and the Gate Check — the sole blocker — is now green with a fix confirmed legitimate on independent re-derivation, not just re-reading the commit's own claims.

**Lessons**: none recorded for this round. This is a clean gate-fix confirmation: no new AC gap, no new surviving mutant, no new spec-precision gap, no new `// SPEC_DEVIATION`. The grounded signal that produced this fix (L-024, mis-isolated pre-existing-vs-regression claim) was already distilled by round 1; confirming the fix landed cleanly is not itself a new signal.

