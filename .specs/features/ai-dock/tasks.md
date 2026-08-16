# Dock de IA — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/ai-dock/design.md`
**Status**: Approved

---

## Test Coverage Matrix

> Generated from codebase sampling (`apps/web/src/sync/syncClient.spec.ts`, `apps/web/src/a11y/shell.a11y.spec.tsx`, `apps/server/src/modules/diagram-sync/bootstrap.int.spec.ts`, `packages/editor-adapter/src/applyRemote.spec.ts`) and this repo's coverage-floor convention (`apps/web/vitest.config.ts`, `apps/server/vitest.config.ts` — coverage floors are a ratchet, never lowered). Guidelines found: no `AGENTS.md`/`CONTRIBUTING.md` in this repo beyond `CLAUDE.md`; `CLAUDE.md`'s "Comandos" section is the authoritative gate list. Strong default applied (all branches, 1:1 to spec ACs, every listed edge case) since no stricter guideline exists.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------- | --------------------- | ----------------- | ------------ |
| Server route (`diagram-sync` bootstrap) | integration | Existing `viewer`/`editor` role assertions extended to also cover `mutatePermissions`; no regression to the existing `permissions` field | `apps/server/src/modules/diagram-sync/bootstrap.int.spec.ts` | `pnpm --filter @arch-canvas/server run test:integration` |
| `editor-adapter` component/utility (`EditorSurface`, `applyRemote` caller) | unit | All branches; selection extraction, imperative handle invocation, LWW merge path | `packages/editor-adapter/src/*.spec.ts`, `*.spec.tsx` | `pnpm --filter @arch-canvas/editor-adapter run test:unit` |
| Client (`AiDockClient`) | unit | Every documented status branch (201 w/ preview, 201 w/o preview, 403, 424, 429 on submit; 200/409 on approve; 200/other on cancel/undo) — 1:1 to Error Handling Strategy table in design.md | `apps/web/src/ai-dock/aiDockClient.spec.ts` | `pnpm --filter @arch-canvas/web run test:unit` |
| Store (`aiDockStore`) | unit | Every phase transition exercised at least once (covered indirectly via `aiDockClient.spec.ts` + `AiDock.spec.tsx`, no separate spec file needed — see Test Co-location Validation) | n/a (covered by consumers) | `pnpm --filter @arch-canvas/web run test:unit` |
| Component (`AiDock`) | unit (RTL) | 1:1 to spec ACs DOCK-01..20 (render gating, submit, preview ordering/limits, approve/discard, 409 handling, undo, error/edge cases) | `apps/web/src/ai-dock/AiDock.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Accessibility (`AiDock`) | unit (axe) | Zero serious/critical violations, mirrors `shell.a11y.spec.tsx`'s `seriousOrCriticalViolations` helper; DOCK-21..23 (keyboard + aria-live + i18n-only text) | `apps/web/src/ai-dock/AiDock.a11y.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Integration (`DiagramEditorPage` wiring) | unit (RTL) | End-to-end within the frontend: approve response → `refreshScene` → `applyRemoteScene` actually called with the fresh scene; canMutate gating end to end | `apps/web/src/diagram/DiagramEditorPage.spec.tsx` (new file — none exists today) | `pnpm --filter @arch-canvas/web run test:unit` |
| i18n JSON (`translation.json` × 2) | none | Build/lint gate only — a missing key surfaces as a rendered key string in the RTL tests above, which is coverage enough | `apps/web/src/i18n/locales/{en,pt-BR}/translation.json` | build gate only |

## Gate Check Commands

> Generated from `CLAUDE.md`'s "Comandos" section and each package's `package.json#scripts`.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After a task with unit tests only, scoped to one package | `pnpm --filter @arch-canvas/<pkg> run test:unit` |
| Full | After a task with integration tests, or closing a phase | `make lint && make typecheck && make test-unit` (+ `make test-integration` for the server task) |
| Build | Closing the feature | `make lint && make typecheck && make test-unit && make test-integration` (per `CLAUDE.md`'s documented sandbox substitute for `make ci`) |

---

## Execution Plan

### Phase 1: Foundation (servidor + editor-adapter)

```
T1
T2 → T3
```

### Phase 2: Cliente e store do dock (apps/web)

```
T4
T5 → T6
```

### Phase 3: Componente e integração

```
T4 → T7
T6 → T7 → T8
T1 → T9
T3 → T9
T7 → T9
```

---

## Task Breakdown

### T1: Add `mutatePermissions` to the bootstrap response — DONE

**What**: Extend the `GET /diagrams/:id/bootstrap` handler to also compute and return `mutatePermissions` (the `diagram:mutate` decision), additive alongside the existing `permissions` (`diagram:read`) field.
**Where**: `apps/server/src/modules/diagram-sync/routes.ts` (handler around line 56-82)
**Depends on**: None
**Reuses**: `can()` from `@arch-canvas/auth`, same call shape as `apps/server/src/modules/ai-engine/routes.ts:133`
**Requirement**: DOCK-02

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `mutatePermissions: { allowed: boolean; reason: string }` present in the response body, computed via `can({ role }, 'diagram:mutate', { workspaceId })`
- [x] Existing `permissions` field byte-for-byte unchanged (no rename, no shape change)
- [x] `bootstrap.int.spec.ts` extended: a `viewer`-role case asserts `mutatePermissions.allowed === false`; an `editor`/mutate-capable role case asserts `mutatePermissions.allowed === true`
- [x] Gate check passes: `pnpm --filter @arch-canvas/server run test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(diagram-sync): add mutatePermissions to the bootstrap response`

---

### T2: Add `onSelectionChange` to `EditorSurface` — DONE

**What**: Extend `EditorSurfaceProps` with `onSelectionChange?: (ids: string[]) => void`, wired from Excalidraw's `onChange` second argument (`appState.selectedElementIds`).
**Where**: `packages/editor-adapter/src/EditorSurface.tsx`
**Depends on**: None
**Reuses**: existing `onChange` wiring pattern in the same file
**Requirement**: DOCK-03

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `onSelectionChange` prop added, called with the array of ids whose `selectedElementIds[id]` is truthy, on every `onChange` firing (even when `onDeltas` doesn't fire because there was no element delta — selection-only changes must still propagate)
- [x] Existing `initialElements`/`onDeltas` behavior unchanged (regression-checked by existing `EditorSurface` tests, if any, or added if none exist)
- [x] Unit test asserts `onSelectionChange` receives the correct id array from a mocked Excalidraw `onChange` call with a non-empty `selectedElementIds` map, and an empty array when nothing is selected
- [x] Gate check passes: `pnpm --filter @arch-canvas/editor-adapter run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(editor-adapter): expose onSelectionChange from EditorSurface`

---

### T3: Add imperative `applyRemoteScene` handle to `EditorSurface` — DONE

**What**: Convert `EditorSurface` to `forwardRef`, exposing `{ applyRemoteScene(remote: readonly SceneElement[]): void }` via `useImperativeHandle`, which fuses `remote` with the current local scene through `applyRemote` and pushes the result via `excalidrawAPI.updateScene(...)`.
**Where**: `packages/editor-adapter/src/EditorSurface.tsx`
**Depends on**: T2 (same file, sequential to avoid churn)
**Reuses**: `applyRemote` (`packages/editor-adapter/src/applyRemote.ts`)
**Requirement**: DOCK-13, DOCK-18 (AD-010)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `excalidrawAPI` captured via the `<Excalidraw excalidrawAPI={...}/>` prop into a ref
- [x] `applyRemoteScene` calls `applyRemote(currentLocalElements, remote, appState)` then `excalidrawAPI.updateScene({ elements: ... })`
- [x] `EditorSurface` consumers using it as a plain (non-ref) component are unaffected — `forwardRef` is backward compatible when no ref is passed
- [x] Unit test mounts `EditorSurface` with a ref, calls `applyRemoteScene` with a scene that both adds and conflicts with a locally-mutated element, and asserts the LWW-correct merged result reaches `updateScene`
- [x] Gate check passes: `pnpm --filter @arch-canvas/editor-adapter run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(editor-adapter): add applyRemoteScene imperative handle to EditorSurface`

---

### T4: Add `aiDock` i18n keys (pt-BR, en) — DONE

**What**: Add a new top-level `"aiDock": {...}` block to both locale files, covering every user-visible string the dock needs (labels, statuses, preview list headers, error messages incl. per-`errorCode` and a generic fallback that still interpolates the raw code, rate-limit message, aria-live announcements).
**Where**: `apps/web/src/i18n/locales/en/translation.json`, `apps/web/src/i18n/locales/pt-BR/translation.json`
**Depends on**: None
**Reuses**: existing nesting convention (`saveStatus`, `diagram` blocks)
**Requirement**: DOCK-21..23

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Both locale files have an identical key set under `aiDock` (no key present in one and missing in the other)
- [x] Includes at minimum: `aiDock.title`, `aiDock.requestLabel`, `aiDock.submit`, `aiDock.status.<phase>` per `AiDockPhase`, `aiDock.preview.{added,removed,moved,modified,metadataChanged}`, `aiDock.approve`, `aiDock.discard`, `aiDock.undo`, `aiDock.rateLimited`, `aiDock.conflict`, `aiDock.error.no_provider_configured`, `aiDock.error.unknown` (interpolates `{{code}}`), `aiDock.sensitiveChange`
- [x] `make lint` passes (JSON validity + formatting)

**Tests**: none (build gate only, per matrix)
**Gate**: quick (`make lint`)

**Commit**: `feat(web): add aiDock i18n keys for pt-BR and en`

---

### T5: Create `aiDockStore` (Zustand factory) — DONE

**What**: `createAiDockStore()` factory returning a Zustand store with `AiDockState` (phase, requestText, run, preview, requiresExplicitApproval, errorCode, lastSnapshotId, rateLimitedUntil) and the actions listed in design.md's Components section.
**Where**: `apps/web/src/ai-dock/aiDockStore.ts`
**Depends on**: None
**Reuses**: `createSaveStatusStore` (`apps/web/src/sync/saveStatus.ts:24-47`) as the structural template
**Requirement**: DOCK-01..20 (state substrate for all of them)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] All fields and actions from design.md's `AiDockState` interface implemented
- [x] `aiDockStatusTranslationKey(phase)` helper exported, mirroring `saveStatusTranslationKey`
- [x] Unit test exercises every action at least once, asserting the resulting state shape (submitStart→submitting, submitSuccess→awaiting_approval with preview set, submitFailed→error with errorCode, rateLimited→rate_limited with rateLimitedUntil set, approveStart→approving, approveSuccess→applied with lastSnapshotId set, approveConflict→idle with preview cleared and requestText preserved, cancelled→idle, undoStart→restoring, undoSuccess→idle, undoFailed→ still offering undo, reset→idle)
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add aiDockStore state factory`

---

### T6: Create `AiDockClient`

**What**: HTTP client class calling the 4 consumed routes (`POST .../ai/runs`, `POST /ai/runs/:runRef` ×2 actions, `POST .../snapshots/:id:restore`, `GET .../bootstrap` for refresh), branching by status code exactly as design.md's Error Handling Strategy table specifies, and driving the `aiDockStore` actions from T5.
**Where**: `apps/web/src/ai-dock/aiDockClient.ts`
**Depends on**: T5
**Reuses**: `DiagramSyncClient` (`apps/web/src/sync/syncClient.ts`) as the structural template — injectable `fetchImpl`, per-status branching
**Requirement**: DOCK-01, DOCK-03..05, DOCK-06..10, DOCK-11..16, DOCK-17..19

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `submitRequest` sends the exact body shape (`userRequest`, `language`, `selection` — omitted when empty, per DOCK-03) and branches 201(w/preview)/201(w/o preview)/403/424/429 into the correct store actions
- [ ] `approve` branches 200/409 correctly, and only updates `lastSnapshotId`/`applied` phase after a resolved 200 (never optimistically)
- [ ] `cancel` calls the store's `cancelled` action unconditionally on a resolved response
- [ ] `undo` branches 200/other, never calling `undoSuccess` on a non-200
- [ ] `refreshScene` calls `GET .../bootstrap` and returns `{ scene }` for the caller (`DiagramEditorPage`) to merge via `applyRemoteScene` — does not itself touch the canvas
- [ ] Unit test covers every branch listed in design.md's Error Handling Strategy table, using the `jsonResponse(status, body)` + injected `fetchImpl: vi.fn()` pattern from `syncClient.spec.ts`
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add AiDockClient`

---

### T7: Create `AiDock` component

**What**: The dock UI itself — collapsible panel, request `<textarea>`, submit button, preview lists (removed first when non-empty, capped at 50 visible + total count), approve/discard/undo buttons, `aria-live="polite"` status region, entirely keyboard-operable, all text from `t('aiDock....')`.
**Where**: `apps/web/src/ai-dock/AiDock.tsx`
**Depends on**: T4, T6
**Reuses**: native HTML controls only (per the `LanguageSwitcher.tsx` convention); `useTranslation`
**Requirement**: DOCK-01, DOCK-02, DOCK-04, DOCK-06..12, DOCK-14, DOCK-16, DOCK-20..23, Edge Cases (>50 elements, empty/whitespace-only request, provider not configured, expired run)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Renders nothing (`return null`) when `canMutate` is `false` — not even disabled (DOCK-02)
- [ ] Request field present in the DOM and keyboard-reachable when `canMutate` is `true` (DOCK-01)
- [ ] Submit disabled while a run is in flight; blank/whitespace-only text never triggers a submit (Edge Case)
- [ ] Preview renders all 5 lists with counts; `removed` rendered before the other three whenever non-empty (DOCK-07); list capped to 50 visible items with a total count and the rest reachable by scroll (Edge Case)
- [ ] Exactly two terminal actions offered for `awaiting_approval`: approve, discard (DOCK-11); approve always requires the click regardless of `requiresExplicitApproval` (DOCK-12); sensitive-change marker shown next to approve when `requiresExplicitApproval` is `true` (DOCK-16)
- [ ] On approve success, calls the `onApproved` prop (design.md's callback into `DiagramEditorPage`) — never touches canvas state directly
- [ ] Undo offered only for the run applied most recently in the current session (DOCK-20)
- [ ] `aria-live="polite"` region announces every phase transition (DOCK-22); all visible text sourced from i18n keys, verified with both locales in the test (DOCK-23)
- [ ] Unit tests (RTL) cover: hidden without `canMutate`; full happy path (submit → preview → approve); discard path; 409-on-approve path (preview cleared, text preserved); 429 path (message shown, text preserved, re-enabled after the mocked 60s); undo path; expired-run edge case; provider-not-configured edge case
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add AiDock component`

---

### T8: Add `AiDock` accessibility test

**What**: New `AiDock.a11y.spec.tsx` asserting zero serious/critical axe violations for the dock in its key states (idle, awaiting_approval with preview, error), matching `shell.a11y.spec.tsx`'s convention.
**Where**: `apps/web/src/ai-dock/AiDock.a11y.spec.tsx`
**Depends on**: T7
**Reuses**: `seriousOrCriticalViolations` helper pattern from `apps/web/src/a11y/shell.a11y.spec.tsx`
**Requirement**: DOCK-21..23

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `jest-axe` run against `AiDock` rendered in at least 3 states (idle/collapsed, awaiting_approval with a non-trivial preview, error with an `errorCode`)
- [ ] Zero serious/critical violations in every state
- [ ] `shell.a11y.spec.tsx`'s header comment (noting the dock has no component yet) updated to remove that now-stale note
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `test(web): add AiDock accessibility coverage`

---

### T9: Wire `AiDock` into `DiagramEditorPage`

**What**: Restructure the page layout to a row (existing column becomes a `flex:1, minHeight:0` child, `AiDock` the sibling), pass `canMutate` (from bootstrap's new `mutatePermissions`) and `selection` (from `EditorSurface`'s new `onSelectionChange`) into `AiDock`, and implement the `onApproved` callback: call `AiDockClient.refreshScene()` then `editorSurfaceRef.current.applyRemoteScene(scene)`. Same callback reused for the undo success path.
**Where**: `apps/web/src/diagram/DiagramEditorPage.tsx`
**Depends on**: T1, T3, T7
**Reuses**: everything from T1/T3/T4-T8
**Requirement**: DOCK-01..23 (integration point for the whole feature)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Layout is a row; canvas sizing behavior (the `flex:1, minHeight:0` trick documented at the current line 75-76) is unchanged/still verified
- [ ] `canMutate` read from `bootstrapResult.mutatePermissions.allowed` and passed to `AiDock`
- [ ] `selection` state updated from `EditorSurface`'s `onSelectionChange`, passed to `AiDock`
- [ ] `onApproved` (and the undo success path) calls `refreshScene()` then `applyRemoteScene(scene)` via the `EditorSurface` ref — never applies a patch before the corresponding HTTP call resolves 200 (DOCK-13)
- [ ] New integration test file `DiagramEditorPage.spec.tsx`: mounts the full page with a mocked `fetch` covering bootstrap + a full ai-run + approve sequence, asserts `applyRemoteScene`'s effect is visible (via a rendered element from the merged scene, or a spy on the exposed ref) only after the approve response resolves; asserts the dock is entirely absent when the mocked bootstrap returns `mutatePermissions.allowed: false`
- [ ] `repo-tools run audit` still exits 0 (no new route was added, so no new audit gap is expected — run it anyway to confirm)
- [ ] Full gate passes: `make lint && make typecheck && make test-unit`

**Tests**: unit (integration-style RTL, per matrix)
**Gate**: full

**Commit**: `feat(web): wire AiDock into DiagramEditorPage`

---

## Phase Execution Map

Tasks within a phase still execute in file order (T1 then T2 then T3, etc.) even where no data
dependency exists between them, but the diagram below shows only real `Depends on` edges — no
phantom reading-order arrows:

```
Phase 1:  T1          T2 ------→ T3
Phase 2:  T4          T5 ------→ T6
Phase 3:            T4 ---┐
                     T6 ---┼--→ T7 ------→ T8
                     T1 ---┤              T3 ---┐
                     T3 ---┤              T7 ---┼--→ T9
                     T7 ---┘
```

In prose: `T2 → T3`; `T5 → T6`; `T4 → T7`, `T6 → T7`; `T7 → T8`; `T1 → T9`, `T3 → T9`, `T7 → T9`.
T1, T2, T4, T5 have no incoming edges — nothing in their own phase blocks them.

**Batching for sub-agent delegation** (9 tasks > ~8 → offer, already pre-authorized this session): Batch 1 = Phase 1 + Phase 2 (T1-T6, 6 tasks). Batch 2 = Phase 3 (T7-T9, 3 tasks) — depends on Batch 1's T1/T3/T4/T6 outputs, runs after Batch 1 reports complete.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: Add `mutatePermissions` to bootstrap | 1 route handler, 1 file | ✅ Granular |
| T2: Add `onSelectionChange` to `EditorSurface` | 1 prop, 1 file | ✅ Granular |
| T3: Add `applyRemoteScene` handle | 1 imperative method, 1 file | ✅ Granular |
| T4: Add `aiDock` i18n keys | 2 JSON files, 1 cohesive key block | ✅ Granular (2 files, same conceptual unit — locale pair) |
| T5: Create `aiDockStore` | 1 store factory, 1 file | ✅ Granular |
| T6: Create `AiDockClient` | 1 client class, 1 file | ✅ Granular |
| T7: Create `AiDock` component | 1 component, 1 file | ✅ Granular |
| T8: Add `AiDock` a11y test | 1 test file | ✅ Granular |
| T9: Wire into `DiagramEditorPage` | 1 file (+1 new test file) | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ----------------------- | -------------- | ------ |
| T1 | None | Phase 1 start, no arrow in | ✅ Match |
| T2 | None | T1 → T2 (reading-order arrow, not a real dependency — documented above) | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | None | T3 → T4 (reading-order arrow, phase boundary) | ✅ Match |
| T5 | None | T4 → T5 (reading-order arrow) | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |
| T7 | T4, T6 | T6 → T7 (phase boundary arrow) — T4 dependency implicit via phase ordering, both satisfied before Phase 3 starts | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |
| T9 | T1, T3, T7 | T8 → T9 (phase boundary arrow) — T1/T3 dependencies implicit via phase ordering (Phase 1 completes before Phase 3 starts) | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | ----------------------------- | ----------------- | ----------- | ------ |
| T1 | Server route (bootstrap) | integration | integration | ✅ OK |
| T2 | `editor-adapter` component | unit | unit | ✅ OK |
| T3 | `editor-adapter` component | unit | unit | ✅ OK |
| T4 | i18n JSON | none | none | ✅ OK |
| T5 | Store | unit (via consumers per matrix note — but this task ships its own dedicated spec, which is stricter, not a violation) | unit | ✅ OK |
| T6 | Client | unit | unit | ✅ OK |
| T7 | Component | unit | unit | ✅ OK |
| T8 | Accessibility | unit (axe) | unit | ✅ OK |
| T9 | Integration wiring | unit (integration-style RTL) | unit | ✅ OK |

---

## Tips

(carried from the skill template — not repeated here)
