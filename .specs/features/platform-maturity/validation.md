# Platform Maturity — Validation (onda F6)

**Date**: 2026-08-16
**Spec**: `.specs/features/platform-maturity/spec.md`
**Tasks**: `.specs/features/platform-maturity/tasks.md` (T1–T17)
**Diff range**: `89e6b4f..53c965c` (18 commits, branch `feature/improvements`)
**Scope**: F6 only — TRU-01..04, CIQ-01..07, UIX-01..04 (15 requirements). AGT/GOV/API/MCP (F7–F9) are out of scope and not built.
**Verifier**: independent sub-agent (author ≠ verifier), evidence-or-zero

---

## Verdict

**Result**: FAIL

**❌ FAIL** — 11/15 ACs match the spec-defined outcome, 2 are gated but not spec-anchored, **2 fail as written**, and the discrimination sensor found **1 surviving mutant**. The tooling is genuinely good and the CI gates are real, not theatre. Two defects block a PASS:

1. **UIX-01 fails its own Independent Test.** The inventory scans only `apps/server/src/modules` and therefore omits three REST routes registered in `apps/server/src/core/server.ts` — `/health/live` (`:210`), `/health/ready` (`:212`), `/metrics` (`:246`). The server registers **82** routes, not 79. `4 + 75 = 79 ≠ 82`, so "a soma de rotas consumidas e pendentes iguala o total de rotas registradas no servidor" is false. The published number in the README, the landing, `docs/capability-map.yaml` and `docs/route-inventory.md` is wrong by the project's own definition — and the omitted `/health/ready` is the exact route CIQ-02's gate asserts on.
2. **Surviving mutant on TRU-02/TRU-03.** `checkCapabilityMap` proves a `ui_surface` *exists under `apps/web/src`*, not that it is a surface for that capability. Repointing "Recuperação após crash do navegador" at `apps/web/src/i18n/locales/en/translation.json` leaves all 31 tests and the audit CLI green.

A third item is a documented-but-unrouted spec deviation: **CIQ-03** requires the Playwright suite to run "contra o stack real"; the `e2e` job runs it against Playwright's own `webServer`, never against the compose stack.

---

## Task Completion

All 17 tasks are marked `✅ Complete` in `tasks.md`, each with one atomic commit in the range. Commit-to-task mapping is 1:1 and every message conforms to Conventional Commits (verified below). No task is partial or blocked.

One traceability defect: `spec.md:200` still lists **CIQ-07 as `Pending`** although T13 shipped `.github/renovate.json` and marked itself complete. The other 14 in-scope rows read `Implementing` and were never advanced to `Verified`.

---

## Spec-Anchored Acceptance Criteria

### P1 — Documentação que não promete o que não existe (TRU)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| **TRU-01** map records backend evidence + UI surface path per announced capability | every entry carries `capability`, `requirements`, `backend_evidence`, `ui_surface` | `tools/repo-tools/src/capabilityMap.ts:11` `REQUIRED_FIELDS = ['capability','requirements','backend_evidence','ui_surface']`; `capabilityMap.spec.ts:148` `expect(violations[0]).toEqual({ entry: 'Docgen', problem: 'missing required field \`backend_evidence\`' })`; `capabilityMap.spec.ts:161` `expect(checkCapabilityMap(map, REPO_ROOT)).toEqual([])` against the real `docs/capability-map.yaml` (26 entries) | ✅ PASS |
| **TRU-02a** null surface ⇒ classified `backend-only` | entry with `ui_surface: null` and no `status: backend-only` is a violation | `capabilityMap.spec.ts:91-93` `expect(violations[0]?.entry).toBe('Comentários')` + `expect(violations[0]?.problem).toContain('backend-only')`; accept-path `capabilityMap.spec.ts:114` `expect(violations).toEqual([])` | ✅ PASS |
| **TRU-02b** product docs SHALL present it in that condition, never as delivered | README/landing describe no `backend-only` capability as user-reachable | **no automated evidence** — `cli.ts:80-121` reads only `docs/capability-map.yaml` and the code; it never opens `README.md` or `docs/architecture-overview.html`. T14's own note concedes "A auditoria não lê o README". Manual entry-by-entry read: prose is correct today (see Doc Honesty) | ⚠️ Ungated — correct by hand, not by CI |
| **TRU-03** CI fails if any entry declares a UI path absent from `apps/web/src` | non-zero exit naming the entry | `capabilityMap.spec.ts:47-49` `expect(violations).toHaveLength(1)`, `expect(violations[0]?.entry).toBe('Dock de IA')`, `expect(violations[0]?.problem).toContain('apps/web/src/ai/AiDock.tsx')`; outside-root case `capabilityMap.spec.ts:69-71`; CLI `cli.spec.ts:68` `expect(result.exitCode).toBe(1)` and `cli.spec.ts:74-75` `expect(result.output.some(l => l.includes('Dock de IA'))).toBe(true)` / `'Apresentação'`; CI wiring `.github/workflows/ci.yaml:263-288` | ⚠️ PASS for *absent* paths; **weak** for wrong-but-present paths (mutant M6 survived) |
| **TRU-04** README + landing declare the requirement count as verified backend contract, with the count of capabilities still without surface | 92 as backend contract; 26 capabilities / 4 with UI / 22 backend-only | `README.md:5-8` ("contrato de backend verificado" + "26 capacidades … 4 têm tela … 22 são `backend-only`" + "79 rotas … 4 … 75"); `docs/architecture-overview.html:941-957` (status panel), `:958`, `:1609`, `:1807`. Numbers re-derived independently: `grep -c '^  - capability:' docs/capability-map.yaml` = 26, `ui_surface: null` = 22, non-null = 4; `docs/route-inventory.md:5-8` = 79/4/75 | ✅ PASS on the numbers as defined; ❌ the **79** is itself wrong (see UIX-01) |

### P1 — CI que prova o sistema de pé (CIQ)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| **CIQ-01** boot the full stack via `docker compose up --build`, fail if any service is not `healthy` within 5 min | red job, not a hung one | `.github/workflows/ci.yaml:210` `docker compose build`, `:215` `timeout 300 docker compose up -d`, `:222` `docker compose up -d --wait --wait-timeout 120 proxy server web postgres minio redis` | ⚠️ PASS with a precision note: build is deliberately outside the budget, but `300 + 120` means an ungated service can be waited on for up to 7 min, not 5 |
| **CIQ-02** `GET /health/ready` on the public port ⇒ HTTP 200, `status == ok`, `postgres == up` | all three asserted | `.github/workflows/ci.yaml:227-244`. Gate logic extracted verbatim and exercised against synthetic bodies: `200/ok/up` → exit 0; `status=degraded` → exit 1; `postgres=down` → exit 1; `dependencies: []` → exit 1; `HTTP 503` → exit 1. Real body shape confirmed against `apps/server/src/core/server.ts:212-236` (`{status, dependencies:[{name,status}]}`, 503 when any dep is down) | ✅ PASS |
| **CIQ-03** run the Playwright suite **against the real stack**, fail on any test failure | suite executed against the booted compose stack | `.github/workflows/ci.yaml:133-183` runs `playwright test --reporter=list,html` in a **standalone job** that boots Playwright's own `webServer` (vite dev + vite-node server). It has no dependency on `compose-smoke` and never touches `http://localhost:8080`. T11 documents the choice ("a suíte é autossuficiente e não depende do stack do compose") | ❌ **Spec deviation** — the suite runs, but not against the real stack |
| **CIQ-04** coverage below the declared floor ⇒ CI fails naming package, floor and measured value | all three named | 12 configs carry `coverage.enabled: true` + `thresholds` (e.g. `packages/diagram-domain/vitest.config.ts:22-31` `lines: 98.02, functions: 93.33, branches: 93.82, statements: 98.02`). Sensor M8: deleting `packages/diagram-domain/src/envelope.spec.ts` yields `ERROR: Coverage for lines (71.92%) does not meet global threshold (98.02%)`; the package name comes from turbo's line prefix under `pnpm -w test:unit` (`@arch-canvas/diagram-domain:test:unit:`), confirmed in the `make test-unit` transcript | ✅ PASS |
| **CIQ-05** validate every PR commit message, fail identifying the **first** non-conforming one | stops at the first offender | `.github/workflows/ci.yaml:45-61` (`git rev-list --reverse --no-merges`, loop, `exit 1` on first failure). Job body executed as shell: real range `89e6b4f..HEAD` → exit 0, "18 commit messages conform"; disposable repo with `feat(a)` → `mensagem invalida` → `fix(b)` → exit 1 at `mensagem invalida`, **never reaching** `fix(b)` | ✅ PASS |
| **CIQ-06** no Docker daemon ⇒ job fails explicitly, never skipped as success | explicit red | `.github/workflows/ci.yaml:194-202`. Branch exercised with `DOCKER_HOST=tcp://127.0.0.1:1`: prints `::error::no Docker daemon on this runner …` and exits 1 | ✅ PASS |
| **CIQ-07** automated dependency updates, grouped per ecosystem, each subject to the full suite | grouped PRs, majors isolated, Node pinned to 22.x | `.github/renovate.json` — 8 ecosystem groups (`react`, `vitest and vite`, `fastify`, `aws-sdk`, `opentelemetry`, `postgres`, `canvas rendering`, `toolchain`), `constraints.node: ">=22 <23"`, a `node` rule with `allowedVersions: "<23"`, and a final `matchUpdateTypes: ['major']` rule with `groupName: null`. "Full suite on each PR" follows from `ci.yaml:4` `on: pull_request` | ⚠️ PASS on config; **`spec.md:200` still marks CIQ-07 `Pending`**, and Renovate needs the app installed on the repo — not provable here |

### P1 — Inventário e decomposição do gap de produto (UIX)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| **UIX-01** inventory maps **every registered REST route** to its consuming UI surface, explicitly marking routes with no consumer | consumed + pending == total registered in the server | `routeInventory.spec.ts:66-69` `expect(inventory.totals.consumed).toBe(2)`, `.pendingProduct).toBe(3)`, `expect(consumed + pendingProduct).toBe(routes.length)`, `expect(totals.routes).toBe(routes.length)`; consumed naming `routeInventory.spec.ts:21-29`; real-repo floor `serverRoutes.spec.ts:96-102`. **But** `serverRoutes.ts:15` `const MODULES_DIR = 'apps/server/src/modules'` — the scan never reaches `apps/server/src/core/server.ts:210,212,246`. Independent count: 79 in `modules`, **3 more in `core`** = 82 | ❌ **GAP** — the invariant holds inside the tool's own scope but fails the spec's Independent Test against the server |
| **UIX-02** each capability without surface enters the product roadmap as its own spec in `.specs/features/`, squad-sized | one roadmap entry per `backend-only` capability | `.specs/features/platform-maturity/ui-roadmap.md` — 16 `### R*` entries + 6 declared operational = 22, matching the 22 `backend-only` entries. Each entry declares scope, backend routes, dependencies and a wave estimate. No automated check | ⚠️ Spec-precision gap — the AC says "spec própria em `.specs/features/`"; what exists is a roadmap **index** that defers each spec to its own Specify round. Only `ai-dock` has an actual spec |
| **UIX-03** specify the AI dock as the first vertical slice | complete EARS spec | `.specs/features/ai-dock/spec.md` (23 requirements, prefix `DOCK`). `python3 .claude/skills/tlc-spec-driven/scripts/validate_spec.py .specs/features/ai-dock/spec.md` → **exit 0, 0 errors, 0 warnings** | ✅ PASS |
| **UIX-04** a new REST route with no UI consumer is recorded as `pending-product`, never unclassified | classification `pending-product`, no escape category | `routeInventory.spec.ts:35-36` `expect(inventory.routes[0]?.classification).toBe('pending-product')` + `expect(consumedBy).toEqual([])`; no-escape `routeInventory.spec.ts:45-49` `expect(routes.map(e => e.classification)).toEqual(['consumed','pending-product','pending-product'])`; type-level `routeInventory.ts:5` `type RouteClassification = 'consumed' \| 'pending-product'` | ✅ PASS |

**Status**: 11/15 match the spec outcome · 2 ❌ fail as written (UIX-01, CIQ-03) · 2 ⚠️ spec-precision / ungated (TRU-02b, UIX-02)

---

## Discrimination Sensor

**Isolation**: two temporary `git worktree`s under the session scratchpad (`.../scratchpad/mut`, `.../scratchpad/compose`), created with `git worktree add … HEAD --detach`. No `git stash` at any point. Baseline `git status --porcelain` on the real tree was **empty** before the sensor and **empty** after — re-checked at the end of every mutation block.

| # | Target | Mutation | Expected killer | Result |
| --- | --- | --- | --- | --- |
| **M1** | `tools/repo-tools/src/capabilityMap.ts:70-75` | Removed the `existsSync` check so a `ui_surface` pointing at a non-existent file is accepted | TRU-03 tests + audit CLI | ✅ **Killed** — 3 failures: `capabilityMap.spec.ts:47`, `cli.spec.ts:68`, `cli.spec.ts:74` |
| **M2** | `tools/repo-tools/src/routeInventory.ts:65,89` | `routes.slice(1).map(...)` while keeping `totals.routes = routes.length`, so a route is silently dropped and `consumed + pending != total` | UIX-01 invariant | ✅ **Killed** — 8 failures: all 7 in `routeInventory.spec.ts` (incl. the invariant at `:66-69`) plus `cli.spec.ts:85` |
| **M3** | `tools/repo-tools/src/serverRoutes.ts:25` | `isProductionSource` reduced to `fileName.endsWith('.ts')`, breaking the `*.spec.ts` exclusion so test fixtures leak into the inventory | fixture-exclusion tests | ✅ **Killed** — 2 failures: `serverRoutes.spec.ts:51` and `:64` |
| **M4** | `.github/workflows/ci.yaml:222,240-244` | Stripped `--wait-timeout 120` **and** deleted the `postgres == up` assertion from `compose-smoke` | — | ❌ **Survived** the unit suite (31/31 still green) — expected: `tasks.md:26` declares workflow YAML `Test Type: none`. Compensating evidence: the assertion block was extracted and proven to discriminate (see CIQ-02 row) — the gate itself is real, only unprotected against future edits |
| **M5** | `tools/repo-tools/src/capabilityMap.ts:62` | Disabled the `apps/web/src/` prefix requirement, so a server file counts as a UI surface | TRU-02 location test | ✅ **Killed** — `capabilityMap.spec.ts:69` |
| **M6** | `docs/capability-map.yaml:46` | Repointed "Recuperação após crash do navegador" from `apps/web/src/sync/syncClient.ts` to `apps/web/src/i18n/locales/en/translation.json` — an existing file that is not a surface for that capability | TRU-02/TRU-03 | ❌ **SURVIVED** — 31/31 tests pass, audit exits 0. The gate proves *existence and location*, not *relevance* |
| **M7** | `tools/repo-tools/src/webConsumers.ts:31` | `isProductionSource` reduced to `isSource`, so frontend `*.spec.ts` count as production consumers | consumer-exclusion test | ✅ **Killed** — `webConsumers.spec.ts:95` |
| **M8** | `packages/diagram-domain/src/envelope.spec.ts` | Deleted the file to drop measured coverage below the declared floor | CIQ-04 coverage gate | ✅ **Killed** — `ERROR: Coverage for lines (71.92%) does not meet global threshold (98.02%)` (+ functions, statements) |

**Sensor depth**: 8 mutations (P0-full tier — this wave *is* the integrity gate for everything else)
**Result**: **6 killed / 2 survived** — ❌

- **M6 is a genuine finding** → fix task.
- M4 is survived-by-design (workflow YAML has no possible suite) and is mitigated by the extracted-shell reproduction, but it means any future edit that guts `compose-smoke` merges silently.

---

## Gate Check

- **Declared Build gate**: `make ci` (`tasks.md:39`)
- **Substitution applied** (pre-existing, unrelated to this wave): `make ci` runs `test-integration`, which needs `pg_lsclusters` and `redis-server` — neither is installed on this machine. Failures are `ENOENT` spawn errors, never assertion failures. Ran `make lint && make typecheck && make test-unit` instead, per the environment note at `tasks.md:111`.
- **Node**: v22.23.2 (`fnm use 22 && corepack enable`), as AC-mandated.

| Step | Result |
| --- | --- |
| `make lint` | ✅ 423 files checked, 0 errors, 4 warnings (pre-existing) |
| `make typecheck` | ✅ 24/24 tasks successful |
| `make test-unit` | ✅ 23/23 tasks successful, exit 0, all coverage floors met |
| `pnpm --filter @arch-canvas/repo-tools run test:unit` (fresh, uncached) | ✅ **31 passed** in 5 files — matches the claim exactly (serverRoutes 6, webConsumers 6, routeInventory 7, capabilityMap 7, cli 5) |
| `repo-tools audit` artifact vs. tree | ✅ `docs/route-inventory.md` regenerates byte-identical (`git status --porcelain` empty after) |

**Test count delta**: +31 unit tests (`tools/repo-tools`), +0 deletions. No test was weakened or skipped.

---

## CI Gates — real or theatre?

| Job | Would it fail on the defect it claims to catch? | Basis |
| --- | --- | --- |
| `commit-lint` (`ci.yaml:29-61`) | **Yes.** Stops at the first non-conforming message and names it | Job body executed as shell on the real range (exit 0, 18 commits) and on a disposable 3-commit repo (exit 1 at the bad middle commit, third commit never reached) |
| `capability-audit` (`ci.yaml:263-288`) | **Yes for a removed/relocated surface** (M1, M5 killed; T7/T12 reproduced the CLI naming the entry). **No for a wrong-but-present surface** (M6 survived) | Mutation sensor + `cli.spec.ts:68,74-75` |
| `compose-smoke` (`ci.yaml:185-261`) | **Yes for the three assertions.** `HTTP != 200`, `status != ok`, `postgres != up` and a missing `postgres` dependency each exit 1 | Assertion block extracted verbatim and run against 5 synthetic bodies |
| `compose-smoke` — Docker absent (`:194-202`) | **Yes.** Explicit red, never a silent skip | Branch exercised with `DOCKER_HOST=tcp://127.0.0.1:1` → exit 1 |
| `e2e` (`ci.yaml:133-183`) | **It runs the suite and fails on failure** — but against Playwright's own `webServer`, **not** the real stack CIQ-03 names. The suite is also a single test (`apps/web/e2e/crash-recovery.spec.ts`) | Workflow read; `grep -c "test("` = 1 |
| Coverage floors (12 × `vitest.config.ts`) | **Yes.** Names floor and measured value; turbo's prefix supplies the package name | Sensor M8 |

**Not theatre.** The compose-smoke job in particular is the opposite of the pattern it was written to fix: it boots, waits with a hard timeout, and asserts a parsed body rather than a status line. Its one structural weakness is that nothing protects the YAML itself from being gutted.

---

## Documentation honesty — plain judgment

Read as an outsider, **neither `README.md` nor `docs/architecture-overview.html` still asserts a capability the user cannot reach.** The rewrite is real, not cosmetic:

- The README splits "O que é" into **"Com tela hoje"** (4 items) and **"Contrato de backend verificado, ainda sem tela"**. The AI engine — the product's declared differentiator — moved into the second list and is named as such.
- The landing carries a hero status panel plus 5 `contrato de backend · sem tela` badges and 6 per-section `surface-note`s. Three present-tense UI claims were rewritten, not merely annotated ("Um botão Gerar documentação" → "A geração de documentação"; the mockup caption now says "Mockup ilustrativo, não uma captura de tela … nenhum componente equivalente existe hoje em `apps/web`").
- All three surviving `92/92` mentions (`:958`, `:1609`, `:1807`) are qualified as "requisitos de **backend** verificados".

**Tone: honest precision, not spin and not self-flagellation.** "Os 92 requisitos … são um contrato de backend verificado … É a parte forte do trabalho e ela está de pé" keeps the earned credit; "A superfície de produto vem atrás e é medida à parte" states the deficit without theatrics. This is the right register.

**Numbers verified against the artifacts and the tree, not the prose:**

| Claim | Source of truth | Verdict |
| --- | --- | --- |
| 26 capabilities | `grep -c '^  - capability:' docs/capability-map.yaml` = 26 | ✅ |
| 4 with UI / 22 backend-only | `ui_surface: null` = 22; non-null = 4 (`DiagramEditorPage.tsx` ×2, `syncClient.ts`, `AppShell.tsx`) — all 4 exist on disk | ✅ |
| 4 consumed / 75 pending | `docs/route-inventory.md:6-7`; regenerated identically | ✅ |
| **79 routes** | `apps/server/src/modules` = 79, **but the server also registers `/health/live`, `/health/ready`, `/metrics` in `apps/server/src/core/server.ts`** → **82** | ❌ **understated by 3** |

Three residual honesty snags, in descending severity:

1. **The 79 is wrong** (above). It is repeated in `README.md:8`, the landing status panel, `docs/capability-map.yaml:17` and `docs/route-inventory.md:5`.
2. **"esta distinção não depende de disciplina de quem escreve documentação"** (README:8) and "a distinção não depende de disciplina de quem escreve esta página" (landing) **overstate the gate**. `repo-tools audit` never reads either document — it validates the map against the filesystem. The prose→map correspondence is exactly what still depends on discipline. The sentence is one degree stronger than what the CI actually proves.
3. **The 4th surface is thin.** `apps/web/src/app-shell/AppShell.tsx` is a header, a language switcher and an empty `<main />` carrying the comment `nav/search/admin land here in F1+` — the very artifact the spec's own Problem Statement cites as evidence of the gap. Counting "Acessibilidade do shell da aplicação" among the 4 delivered capabilities is defensible (it renders, and `shell.a11y.spec.tsx` covers it) but it flatters the number. Likewise `syncClient.ts` is a module, not a screen.

---

## Edge Cases (F6 subset)

- [x] Capability map pointing at a component removed in a refactor ⇒ CI fails — `capabilityMap.spec.ts:47-49`, sensor M1
- [x] Healthcheck flapping ⇒ final state after the timeout decides — `ci.yaml:216-222`, documented at `:219-221`; `--wait` evaluates final state
- [ ] **New package with no declared coverage floor ⇒ CI fails demanding the declaration** — **NOT handled.** Nothing enumerates `vitest.config.ts` files or asserts a `thresholds` block. `packages/database` has no `test:unit` and no floor, and nothing fails. A new package would silently ship uncovered
- n/a MCP cross-workspace token, empty OpenAPI, `STATE.md` merge — F8/F9

---

## Code Quality

| Principle | Status |
| --- | --- |
| No features beyond what was asked | ✅ |
| No abstractions for single-use code | ✅ — plain functions, no premature interfaces |
| No unnecessary flexibility | ✅ |
| Only touched files required for the tasks | ✅ — the 12 `vitest.config.ts` edits are one uniform change, declared in T8 |
| Didn't "improve" unrelated code | ✅ |
| Matches existing patterns/style | ✅ — `tools/repo-tools` mirrors `packages/diagram-domain` layout exactly |
| Would a senior engineer approve? | ✅ for the tooling; the scan-root omission is the kind of thing review should have caught |
| Tests map to ACs, non-shallow | ✅ — every `describe` names its requirement IDs; assertions target values, not shapes |
| Spec-anchored outcome check | ⚠️ — see UIX-01, CIQ-03 |
| Per-layer Coverage Expectation met | ✅ domain logic 1:1 with ACs (92.2% lines in `repo-tools`); ⚠️ workflow layer has no possible suite, by declared design |
| Every test maps to a spec AC / edge case / Done-when | ✅ — 31/31 accounted for, no unclaimed tests |
| Documented project guidelines followed | none exist (no `CLAUDE.md`/`CONTRIBUTING.md` — that is AGT-01, wave F7) — strong defaults applied |

---

## Fix Plans

### Fix 1 — Inventory misses routes registered outside `apps/server/src/modules` (Blocker, UIX-01)

- **Root cause**: `tools/repo-tools/src/serverRoutes.ts:15` hardcodes `MODULES_DIR = 'apps/server/src/modules'`; `/health/live`, `/health/ready` and `/metrics` are registered in `apps/server/src/core/server.ts:210,212,246`.
- **Fix**: scan `apps/server/src` (keeping the `*.spec.ts` exclusion), or declare the exclusion explicitly in the artifact and the spec. Add a test asserting the real repo yields **82** routes and that `/health/ready` is present. Regenerate `docs/route-inventory.md` and update the count in `README.md`, `docs/architecture-overview.html` and the `docs/capability-map.yaml` header.
- **Verify**: `consumed + pending` equals an independently counted total over all of `apps/server/src`.

### Fix 2 — Capability map surface check proves existence, not relevance (Major, TRU-02/03 — surviving mutant M6)

- **Root cause**: `capabilityMap.ts:62-75` validates prefix + `existsSync` only.
- **Fix**: require `ui_surface` to be a `.tsx`/`.ts` module reachable from `apps/web/src/App.tsx`'s import graph, or require each entry to name a symbol/test that exercises it; at minimum reject non-source extensions.
- **Verify**: re-run M6 — repointing a capability at `i18n/locales/en/translation.json` must exit non-zero.

### Fix 3 — CIQ-03 says "real stack", the job uses Playwright's own webServer (Major)

- **Fix**: either point the `e2e` job at the compose stack (`baseURL=http://localhost:8080`, `depends_on: compose-smoke`), or amend the AC so the spec matches the shipped design. Do not leave the divergence only in `tasks.md`.

### Fix 4 — Ungated edge case: new package without a coverage floor (Minor, CIQ-04)

- **Fix**: add a check (natural home: `repo-tools audit`) asserting every workspace package with a `test:unit` script declares `coverage.thresholds`.

### Fix 5 — Traceability + overstated gate claim (Minor)

- `spec.md:200`: advance CIQ-07 off `Pending`; advance the 14 verified rows.
- Soften "não depende de disciplina de quem escreve documentação" in `README.md:8` and the landing to what the audit actually proves (the map, not the prose) — or make the audit read the docs.

---

## Requirement Traceability Update

| Requirement | Previous | New |
| --- | --- | --- |
| TRU-01 | Implementing | ✅ Verified |
| TRU-02 | Implementing | ⚠️ Verified with gap (docs half ungated; M6 survived) |
| TRU-03 | Implementing | ⚠️ Verified with gap (M6 survived) |
| TRU-04 | Implementing | ⚠️ Needs Fix (route count wrong) |
| CIQ-01 | Implementing | ✅ Verified |
| CIQ-02 | Implementing | ✅ Verified |
| CIQ-03 | Implementing | ❌ Needs Fix (not run against the real stack) |
| CIQ-04 | Implementing | ✅ Verified |
| CIQ-05 | Implementing | ✅ Verified |
| CIQ-06 | Implementing | ✅ Verified |
| CIQ-07 | **Pending** (stale) | ✅ Verified (config); update the row |
| UIX-01 | Implementing | ❌ Needs Fix (3 routes unscanned) |
| UIX-02 | Implementing | ⚠️ Spec-precision gap (index, not per-capability specs) |
| UIX-03 | Implementing | ✅ Verified |
| UIX-04 | Implementing | ✅ Verified |

---

## Not verifiable here

Stated plainly, because a green local run is not a green pull request:

1. **Anything that requires an actual pull request event**: `github.event.pull_request.base.sha` / `head.sha` arriving populated, `if: github.event_name == 'pull_request'` selecting `commit-lint`, and `on: pull_request` firing all 9 jobs on a Renovate PR (CIQ-07's "full suite on each PR").
2. **`actions/*` behaviour**: `upload-artifact@v4` publishing `compose-diagnostics.txt`, `playwright-report/` and `route-inventory.md`; `if: failure()` / `if: always()` semantics; `actions/cache@v4` hit/miss for `~/.cache/ms-playwright`.
3. **Ubuntu-runner specifics**: `timeout` from coreutils (absent on this macOS host — a contract-equivalent substitute was used: kills the child, exits 124), `playwright install --with-deps` fetching Ubuntu system libraries, and whether the Linux runner's measured coverage lands within the floors calibrated on macOS/Node 22.23.2 (T8 flags a possible 0.01-point miss).
4. **CIQ-06 in its true condition**: the Docker-absent branch was exercised by pointing `DOCKER_HOST` at a dead socket, which proves the shell logic; a runner genuinely without Docker is a different environment.
5. **Renovate itself**: `renovate.json` is inert unless the Renovate app (or a self-hosted runner) is installed on the repository. Nothing in the repo proves that.
6. **`make ci` in full**: `test-integration` cannot run here (`pg_lsclusters`, `redis-server` absent — `ENOENT` spawn failures, pre-existing and unrelated). Substituted with `make lint && make typecheck && make test-unit`.
7. **The compose boot end-to-end**: a real `docker compose build` + `up` was launched in an isolated worktree against the live daemon and was **still building at the time of writing** (the `canvas` native compile on Alpine dominates). The health-assertion *logic* was proven independently against synthetic bodies, and T10 records a successful full boot with the exact response body; this run neither confirms nor contradicts that.

---

## Summary

**Overall**: ❌ Not ready — 2 blocking gaps + 1 surviving mutant

**Spec-anchored check**: 11/15 ACs matched the spec-defined outcome · 2 failed as written (UIX-01, CIQ-03) · 2 spec-precision gaps (TRU-02b, UIX-02)
**Sensor**: 8 mutations, 6 killed, 2 survived (M6 genuine, M4 survived-by-design)
**Gate**: `make lint` ✅ · `make typecheck` ✅ · `make test-unit` ✅ · `repo-tools` 31/31 ✅

**What works**: the audit tooling is small, well-factored and genuinely discriminating — 6 of 6 behaviour-level code mutations were killed by targeted assertions, not by coincidence. The CI gates are real: `commit-lint` stops at the first offender, the `/health/ready` assertions reject all four failure shapes, the Docker-absent branch turns red, and the coverage floors named the exact package, floor and measured value when a test was removed. The documentation rewrite is the strongest part of the wave — the AI dock, the product's declared differentiator, is now explicitly listed as having no interface.

**Issues found**: (1) the inventory's scan root omits 3 registered routes, making the headline "79 routes" wrong and failing UIX-01's own Independent Test; (2) the capability-map gate checks that a surface *file exists*, not that it *is* the surface — a capability can be pointed at a translation JSON and stay green; (3) the `e2e` job does not run against the real stack, contrary to CIQ-03; (4) the "does not depend on documentation discipline" claim is one degree stronger than the gate; (5) the "new package without a coverage floor" edge case is ungated; (6) `spec.md:200` still marks CIQ-07 `Pending`.

**Next steps**: route Fix 1 and Fix 2 to an implementer, then re-verify (iteration 1 of a maximum of 3). Fixes 3–5 can ride along in the same round.

---

## Lessons distillation — deferred to the orchestrator

This Verifier ran under an explicit read-only constraint scoped to writing this report only, so `scripts/lessons.py` was **not** invoked. The report has signal and three lessons should be recorded:

1. *A repo-scanning tool's scan root is an assumption, not a fact — assert the tool's total against an independent count over the whole source tree before publishing the number.* (grounded in: UIX-01, `serverRoutes.ts:15`)
2. *A path-existence check is not a semantic check — a gate that proves a file exists still passes when the file is the wrong one; assert a property only the right file has.* (grounded in: surviving mutant M6, `capabilityMap.ts:62-75`)
3. *When a task deliberately diverges from an AC, amend the spec in the same commit — a deviation recorded only in `tasks.md` reads as verified coverage at validation time.* (grounded in: CIQ-03, `ci.yaml:133-183`)
