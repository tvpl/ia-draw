# ai-dock Validation

## Validation: ai-dock - FAIL ❌

**Date**: 2026-08-16
**Spec**: `.specs/features/ai-dock/spec.md`
**Diff range**: `77c652b^..576f29f` (branch `feature/improvements-3`)
**Verifier**: independent sub-agent (author ≠ verifier)

**Verdict**: ❌ **FAIL** — blocked at the Build-level gate (step 4). Per
`references/validate.md` §4 ("Non-zero exit code = STOP"), the Discrimination Sensor
and Code Quality Check were **not** run. The blocking failure is provably **outside**
this feature's diff surface (see Gate Check below); the AC evidence gathered before the
gate is recorded in full so the re-verify round is cheap.

---

## Task Completion

All 9 tasks are marked `[x]` in `tasks.md` (verified, not assumed) — every "Done when"
box under T1–T9 is checked.

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 — `mutatePermissions` on bootstrap | ✅ Done | `apps/server/src/modules/diagram-sync/routes.ts:73-86`; `permissions` unchanged |
| T2 — `onSelectionChange` on `EditorSurface` | ✅ Done | - |
| T3 — `applyRemoteScene` imperative handle | ✅ Done | AD-010 path, not a remount |
| T4 — `aiDock` i18n keys (pt-BR, en) | ✅ Done | Key sets verified identical across both locales |
| T5 — `aiDockStore` | ✅ Done | Every action has a dedicated test |
| T6 — `AiDockClient` | ✅ Done | ⚠️ `refreshScene()` ships + is tested but has **no production consumer** (see Code Quality) |
| T7 — `AiDock` component | ✅ Done | - |
| T8 — `AiDock` a11y coverage | ✅ Done | 3 states, `seriousOrCriticalViolations` = `[]` |
| T9 — wire into `DiagramEditorPage` | ✅ Done | Carries a self-declared DEVIATION note re: `repo-tools audit` (accurate — see Gate Check) |

---

## Spec-Anchored Acceptance Criteria

### P1: Pedir uma mudança em linguagem natural (DOCK-01..05)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| DOCK-01 WHEN role grants `diagram:mutate` THEN render the dock as a collapsible side panel, request field in DOM + keyboard-reachable | `<details>` panel present; request field focusable | `apps/web/src/ai-dock/AiDock.spec.tsx:89-91` — `expect(field.tagName).toBe('TEXTAREA')` / `expect(document.activeElement).toBe(field)`; `apps/web/src/diagram/DiagramEditorPage.spec.tsx:101` — `expect((row.children[1] as HTMLElement).tagName).toBe('DETAILS')` | ✅ PASS |
| DOCK-02 IF role lacks `diagram:mutate` THEN do not render the dock, not even disabled | Nothing rendered at all | `apps/web/src/ai-dock/AiDock.spec.tsx:80-81` — `expect(container.innerHTML).toBe('')` + `expect(fetchImpl).not.toHaveBeenCalled()`; `apps/web/src/diagram/DiagramEditorPage.spec.tsx:208` — `expect(document.querySelector('details')).toBeNull()`; server side `apps/server/src/modules/diagram-sync/bootstrap.int.spec.ts:118` — `expect(body.mutatePermissions).toMatchObject({ allowed: false })` (viewer) and `:96` `{ allowed: true }` (workspace_admin) | ✅ PASS |
| DOCK-03 WHEN request ≥1 char THEN `POST /diagrams/{id}/ai/runs` with `userRequest`, `language` = active locale, `selection` = selected ids, omitted when empty | Exact request body shape | `apps/web/src/ai-dock/aiDockClient.spec.ts:51-57` — body `JSON.stringify({ userRequest: 'draw three services', language: 'en' })` (no `selection` key); `:81-90` — body includes `selection: ['el-a','el-b']`, `language: 'pt-BR'`; `apps/web/src/ai-dock/AiDock.spec.tsx:134-143` — full body incl. `selection: ['sel-1']` with `language` taken from the live i18n instance | ✅ PASS |
| DOCK-04 WHILE a run is in progress, keep submit disabled and show the current run status, without blocking manual canvas editing | Submit button `disabled === true` during `submitting`/`awaiting_approval`/`approving`/`restoring`; status visible; canvas still editable | Status half only: `apps/web/src/ai-dock/AiDock.spec.tsx:505-509` — `expect(liveRegion?.textContent).toBe('Idle')` → `'Awaiting your approval'`. **No citation** for submit-disabled-during-run (the only `.disabled` assertions, `AiDock.spec.tsx:268` and `:276`, are the DOCK-05 rate-limit path). **No citation** for "manual canvas editing not blocked". | ❌ GAP (partial) |
| DOCK-05 IF HTTP 429 THEN report the 20-req/min limit, preserve the typed text, re-enable submit after 60s | Message shown; `field.value` preserved; `disabled` false after 60 000 ms | `apps/web/src/ai-dock/AiDock.spec.tsx:264-278` — `getByText('Limit of 20 requests per minute reached. Try again in 60 seconds.')`, `expect(submitButton.disabled).toBe(true)`, `expect(field.value).toBe('draw three services')`, then after `vi.advanceTimersByTime(60_000)` → `expect(...disabled).toBe(false)`; `apps/web/src/ai-dock/aiDockClient.spec.ts:143-146` — `rateLimitedUntil: 1_000_000 + 60_000` | ✅ PASS |

### P1: Ver o que vai mudar antes de qualquer coisa mudar (DOCK-06..10)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| DOCK-06 WHEN 201 carries `preview` THEN display the four diff lists (`added`, `removed`, `moved`, `modified`) each with its element count, plus `metadataChanged` | All **five** lists rendered, each with a count | Only 2 of 5 asserted: `apps/web/src/ai-dock/AiDock.spec.tsx:147` — `headings.indexOf('Removed (1)')` / `headings.indexOf('Added (3)')`; `:445` — `getByText('Added (60)')`. **No citation** asserting `moved`, `modified`, or `metadataChanged` render at all. The `indexOf` comparison still passes if the other three headings are missing. | ❌ GAP (partial) |
| DOCK-07 Display `removed` before the other three whenever it has ≥1 element | `removed` heading precedes `added`/`moved`/`modified` | `apps/web/src/ai-dock/AiDock.spec.tsx:146-147` — `expect(headings.indexOf('Removed (1)')).toBeLessThan(headings.indexOf('Added (3)'))` | ✅ PASS (ordering vs `moved`/`modified` not individually compared) |
| DOCK-08 Keep the canvas, the diagram revision and the local mutation queue unchanged while the run is `awaiting_approval` | No canvas write; revision unchanged; queue unchanged | Canvas half only: `apps/web/src/diagram/DiagramEditorPage.spec.tsx:171` — `expect(updateSceneSpy).not.toHaveBeenCalled()` while the Approve button is on screen. **No citation** for "revision unchanged" or "mutation queue unchanged". | ❌ GAP (partial) |
| DOCK-09 WHEN 201 arrives without `preview` THEN display the run's `errorCode` and offer no approve action | `errorCode` from `run.errorCode`; approve absent | `apps/web/src/ai-dock/aiDockClient.spec.ts:106` — `expect(store.getState()).toMatchObject({ phase: 'error', errorCode: 'provider_timeout' })`; approve-absent shown at `apps/web/src/ai-dock/AiDock.spec.tsx:404` / `:420` — `expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()` | ✅ PASS |
| DOCK-10 IF the run ends `failed` THEN display the server's `errorCode`, without flattening it into a generic message that loses the code | Raw code surfaced to the user | `apps/web/src/ai-dock/aiDockClient.spec.ts:106` — `errorCode: 'provider_timeout'` preserved verbatim; render path `apps/web/src/ai-dock/AiDock.spec.tsx:406` — `expect(screen.getByText('Error: unknown')).not.toBeNull()` against `aiDock.error.unknown = "Error: {{code}}"` | ⚠️ Spec-precision gap — the *rendering* assertion uses code `'unknown'`, which is textually identical to the fallback key name, so it cannot distinguish "interpolated the real code" from "hardcoded the word unknown". A render assertion with a distinctive code (e.g. `provider_timeout`) would anchor it. |

### P1: Aprovar explicitamente, ou descartar (DOCK-11..16)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| DOCK-11 Offer exactly two terminal actions for `awaiting_approval`: approve and discard | Both present; nothing else terminal | `apps/web/src/ai-dock/AiDock.spec.tsx:148-149` — `getByRole('button', { name: 'Approve' })` and `{ name: 'Discard' }` both non-null; `:210-211` — both `null` once the run is terminated | ✅ PASS |
| DOCK-12 Require an approval click on **every** run, including when `requiresExplicitApproval` is `false` | No auto-apply on the `false` path | `apps/web/src/ai-dock/AiDock.spec.tsx:150` — with `requiresExplicitApproval: false`, `expect(onApproved).not.toHaveBeenCalled()` before the click, `:157` `toHaveBeenCalledTimes(1)` after; `apps/web/src/diagram/DiagramEditorPage.spec.tsx:171` — `expect(updateSceneSpy).not.toHaveBeenCalled()` while awaiting approval | ✅ PASS — this is the Success-Criteria test that fails if auto-apply is reintroduced |
| DOCK-13 WHEN approving THEN `POST /ai/runs/{runId}:approve`, reflecting the change on the canvas only after HTTP 200 | Canvas write strictly after the 200 resolves | `apps/web/src/ai-dock/aiDockClient.spec.ts:176-181` — `expect(store.getState().phase).toBe('approving')` *before* awaiting, then `toMatchObject({ phase: 'applied', lastSnapshotId: 'snapshot-4' })`, URL `'/ai/runs/run-4:approve'`; `apps/web/src/diagram/DiagramEditorPage.spec.tsx:179-181` — `expect(updateSceneSpy).toHaveBeenCalledTimes(1)` and `sceneData.elements.map(el => el.id)` contains `'el-fresh'` | ✅ PASS |
| DOCK-14 WHEN discarding THEN `POST /ai/runs/{runId}:cancel` and the diagram stays at the pre-run revision | Cancel emitted; revision unchanged | Emission only: `apps/web/src/ai-dock/AiDock.spec.tsx:209` — `expect(fetchImpl).toHaveBeenCalledWith('/ai/runs/run-2:cancel', { method: 'POST' })`. **No citation** for "diagram stays at the previous revision" (no discard test at the `DiagramEditorPage` level). | ❌ GAP (partial) |
| DOCK-15 IF approve responds 409 THEN discard the preview, report that the diagram changed, re-offer the same text, never apply the patch | Preview cleared, text preserved, conflict message, no apply | `apps/web/src/ai-dock/AiDock.spec.tsx:240-246` — `getByText('The diagram changed since your request. Send it again to try once more.')`, `queryByRole('button', { name: 'Approve' })` null, `expect(onApproved).not.toHaveBeenCalled()`, `expect(field.value).toBe('draw three services')`; `apps/web/src/ai-dock/aiDockClient.spec.ts:197` — `toMatchObject({ phase: 'idle', preview: null, run: null })`; `apps/web/src/ai-dock/aiDockStore.spec.ts:132-137` | ✅ PASS |
| DOCK-16 WHERE `requiresExplicitApproval` is `true`, mark the proposal as a sensitive change next to approve | Marker rendered alongside Approve | `apps/web/src/ai-dock/AiDock.spec.tsx:178-179` — `getByText('Sensitive change — review carefully before approving')` plus the Approve button | ✅ PASS (the negative half — marker absent when `false` — is unasserted; low risk) |

### P1: Desfazer a última aplicação (DOCK-17..20)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| DOCK-17 WHEN approve responds 200 THEN store the returned `snapshot.id` and show Undo | `lastSnapshotId` = response `snapshot.id`; Undo visible | `apps/web/src/ai-dock/aiDockClient.spec.ts:181` — `lastSnapshotId: 'snapshot-4'`; `apps/web/src/ai-dock/AiDock.spec.tsx:160` — `expect(screen.getByRole('button', { name: 'Undo' })).not.toBeNull()` | ✅ PASS |
| DOCK-18 WHEN Undo is triggered THEN `POST /diagrams/{id}/snapshots/{snapshotId}:restore` with the approved run's `snapshot.id`, and the canvas returns to the pre-apply content **as a new revision** | Correct restore URL **and** canvas content reverted **and** revision greater than the apply's | Request half only: `apps/web/src/ai-dock/AiDock.spec.tsx:321-323` — `expect(fetchImpl).toHaveBeenCalledWith('/diagrams/diagram-1/snapshots/snapshot-4:restore', { method: 'POST' })`; `apps/web/src/ai-dock/aiDockClient.spec.ts:247-249` same URL. **No citation** for the canvas returning to the previous content, and **no citation** for "as a new revision" (revision greater, not smaller) — the spec's own Independent Test for this story asks precisely for a bootstrap-level check, and no such test exists. | ❌ GAP (partial) |
| DOCK-19 IF restore responds any status ≠ 200 THEN keep Undo available and never report success | Undo still offered; no success signal | `apps/web/src/ai-dock/AiDock.spec.tsx:368-369` — `expect(onApproved).not.toHaveBeenCalled()` and Undo still non-null (500 response); `apps/web/src/ai-dock/aiDockClient.spec.ts:262` — `toMatchObject({ phase: 'applied', lastSnapshotId: 'snapshot-8' })`; `:274` network-failure variant; `apps/web/src/ai-dock/aiDockStore.spec.ts:170` | ✅ PASS |
| DOCK-20 Offer Undo only for the **most recently** applied run in the current editor session | With ≥2 sequential approvals, Undo targets the latest `snapshot.id` | Single-run half only: `apps/web/src/ai-dock/aiDockStore.spec.ts:162` — `toMatchObject({ phase: 'idle', lastSnapshotId: null })` after `undoSuccess`; `apps/web/src/ai-dock/AiDock.spec.tsx:325` — Undo gone after a successful undo. **No citation** for the discriminating scenario (approve run A, then run B, assert the restore call carries B's snapshot, not A's). | ❌ GAP (partial) |

### P2: Operável por teclado e nos dois idiomas (DOCK-21..23)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --------- | -------------------- | ----------------------- | ------ |
| DOCK-21 Operable by keyboard alone in **all** its actions: open, focus field, submit, approve, discard, undo | All six actions keyboard-reachable | 2 of 6 asserted: `apps/web/src/ai-dock/AiDock.spec.tsx:462-468` — field `.focus()` then `expect(document.activeElement).toBe(submitButton)`. **No citation** for keyboard reachability of open (`<summary>`), approve, discard, or undo. (All are native `<button>`/`<details>`, so the risk is low, and `AiDock.a11y.spec.tsx` scans three states for serious/critical axe violations — but neither is an assertion on those four actions.) | ❌ GAP (partial) |
| DOCK-22 WHEN run status changes THEN announce the new status in an `aria-live="polite"` region | Live region text updates on transition | `apps/web/src/ai-dock/AiDock.spec.tsx:504-509` — `document.querySelector('[aria-live="polite"]')` text `'Idle'` → `waitFor(... toBe('Awaiting your approval'))` | ✅ PASS |
| DOCK-23 All visible text from existing i18n keys, in `pt-BR` and `en`, with no text literal in the component | Both locales render translated strings; no literals in `AiDock.tsx` | `apps/web/src/ai-dock/AiDock.spec.tsx:479-488` — pt-BR `getByText('Dock de IA')` / `getByLabelText('Descreva o que você quer mudar')`, then en `getByText('AI dock')` / `getByLabelText('Describe what you want to change')`; no-literal confirmed by inspection of `apps/web/src/ai-dock/AiDock.tsx:136-186` (every string goes through `t(...)`); key sets verified identical across both locale files | ✅ PASS |

**Status**: ❌ Gaps present — **16/23 ACs** fully matched their spec-defined outcome;
**6 ACs partially covered** (DOCK-04, 06, 08, 14, 18, 20, 21 → 7 entries, of which
DOCK-10 is a ⚠️ precision gap rather than a coverage gap). Precise tally: 16 ✅ PASS,
6 ❌ partial-coverage gaps, 1 ⚠️ spec-precision gap.

---

## Edge Cases

- [~] **Run in `awaiting_approval` whose patch no longer exists server-side (post-restart) → treat as expired, never offer approve.** Covered *by substitution*: `apps/web/src/ai-dock/AiDock.spec.tsx:379-407` exercises a 404 on approve and asserts `queryByRole('button', { name: 'Approve' })` is `null` and `onApproved` was not called. The literal "dock mounts with such a run" path cannot occur — the store is process memory (spec Assumptions row: "O run sobrevive a recarregar a página? Não"). The test carries an explicit written justification at `:372-378`. **Note**: the `'expired'` phase exists in `aiDockStore.ts:17` and has an i18n string in both locales, but **no code path ever sets it** — dead state.
- [x] **No AI provider configured → show that config is missing, offer no non-existent path.** `apps/web/src/ai-dock/AiDock.spec.tsx:417-420` — `getByText('No AI provider is configured. This is set up outside the product today.')` and Approve absent; `apps/web/src/ai-dock/aiDockClient.spec.ts:128-131` — `errorCode: 'no_provider_configured'` from 424.
- [~] **Canvas selection changes between request and approval → approval uses the patch computed at request time, without re-evaluating selection.** Indirect evidence only: `apps/web/src/ai-dock/aiDockClient.spec.ts:180` — `toHaveBeenCalledWith('/ai/runs/run-4:approve', { method: 'POST' })` proves the approve call carries **no body at all**, so no selection can be re-sent. **No citation** for a test that actually mutates `selection` between submit and approve.
- [x] **Empty/whitespace-only request → emit no request whatsoever.** `apps/web/src/ai-dock/AiDock.spec.tsx:104` — after typing `'   '` and clicking Send, `expect(fetchImpl).not.toHaveBeenCalled()`.
- [~] **Connection drops during the run → show the network failure, keep the request text, don't leave submit disabled forever.** `apps/web/src/ai-dock/aiDockClient.spec.ts:157` — `toMatchObject({ phase: 'error', errorCode: 'network_error' })`; text preservation at `apps/web/src/ai-dock/aiDockStore.spec.ts:92-96`. **No citation** for the "submit is re-enabled" half at the UI level (it holds by construction — `'error'` is absent from `RUN_ONGOING_PHASES`, `AiDock.tsx:42` — but nothing asserts it).
- [~] **Preview lists >50 touched elements → show the total count, cap the visible list at 50, rest reachable by scrolling.** Count + cap covered: `apps/web/src/ai-dock/AiDock.spec.tsx:445-446` — `getByText('Added (60)')` and `expect(screen.getAllByRole('listitem')).toHaveLength(50)`. ⚠️ **Spec-precision gap** on "com o restante alcançável por rolagem": `AiDock.tsx:160` uses `.slice(0, MAX_VISIBLE_PREVIEW_ITEMS)`, so items 51–60 are never rendered and are unreachable by any scrolling, and there is no `overflow` container anywhere in the component. The Portuguese admits two readings ("the rest of the 60" vs "the rest of the 50 that don't fit the panel"); under the first reading the implementation contradicts the spec, under the second it satisfies it. The spec does not disambiguate.

---

## Gate Check

- **Gate command**: `make lint && make typecheck && make test-unit` (tasks.md Build level, minus `make test-integration` per `CLAUDE.md`'s documented sandbox substitute)
- **Result**: ❌ **non-zero exit (lint)** — `make lint` exits 1; `make typecheck` and `make test-unit` both pass (exit 0) when run separately.
- **Failure detail**: one Biome error, `docs/openapi.json format` — "Formatter would have printed the following content" (Biome's JSON array-collapse formatting, ~30 hunks). Plus 6 pre-existing warnings (`apps/mcp/src/client.spec.ts` unused suppressions ×2, `tools/repo-tools/src/webConsumers.spec.ts` `noTemplateCurlyInString` ×4) which do not fail the gate.
- **Scope of the failure**: **outside this feature.** `docs/openapi.json` is not in `77c652b^..576f29f` (`git diff --name-only ... | grep openapi` → no match). The file was last touched by `9b1efae` *"fix(openapi): regenerate spec to include GET /auth/oidc/status"*, which is **not** in the ai-dock range — it is the follow-up to the unrelated auth feature whose audit gap T9's own DEVIATION note already flagged. The regeneration script wrote the file without running the formatter.
- **Test counts** (typecheck + test-unit leg, run separately): **97 test files, 896 tests, 896 passed, 0 failed, 0 skipped** across 13 packages with tests.
  - `@arch-canvas/web` 11 files / 91 tests · `@arch-canvas/server` 39 / 395 · `@arch-canvas/editor-adapter` 6 / 60 · `@arch-canvas/ai-tools` 5 / 70 · `@arch-canvas/diagram-ir` 9 / 68 · `@arch-canvas/auth` 1 / 63 · `@arch-canvas/repo-tools` 7 / 49 · `@arch-canvas/diagram-domain` 5 / 29 · `@arch-canvas/shared-contracts` 5 / 27 · `@arch-canvas/mcp` 5 / 20 · `@arch-canvas/library-content` 2 / 12 · `@arch-canvas/test-fixtures` 1 / 8 · `@arch-canvas/backup` 1 / 4
- **Test Integrity Check**: ✅ no regression. `git diff --diff-filter=D --name-only 77c652b^..576f29f` matches no test file — **nothing deleted**. Every `*.spec.*` in range is additive (`git diff --numstat`): the only pre-existing test files touched are `bootstrap.int.spec.ts` (+6/−1, an assertion *strengthened* from `expect(response.json().permissions)` to a destructured body plus a new `mutatePermissions` assertion) and `shell.a11y.spec.tsx` (+2/−1, comment only). New in-scope test files add **59 tests** (`AiDock.spec.tsx` 16, `aiDockClient.spec.ts` 17, `aiDockStore.spec.ts` 15, `EditorSurface.spec.tsx` 5, `AiDock.a11y.spec.tsx` 3, `DiagramEditorPage.spec.tsx` 3). No assertion was weakened.
- **Coverage floors**: held — `web/src/ai-dock` at 98.92% statements / 93.69% branches / 100% functions.

---

## Discrimination Sensor

**NOT RUN** — `references/validate.md` §4 mandates STOP on a non-zero gate exit, before
the sensor. No scratch worktree was created; the real working tree was never mutated.

`git status --porcelain` was **empty** at the start of this validation. No sensor
mutation was ever injected and no scratch worktree was created, so nothing in this
validation could have altered the tree.

⚠️ **Concurrent-writer note (not caused by this validation):** by the end of the run the
porcelain was no longer empty —

```
 M apps/web/src/i18n/locales/en/translation.json      (adds auth.submitting)
 M apps/web/src/i18n/locales/pt-BR/translation.json   (adds auth.submitting)
?? apps/web/src/auth/LoginPage.spec.tsx
?? apps/web/src/auth/LoginPage.tsx
```

These appeared mid-run (file mtimes 18:43 and 18:46, after this validation started) and
belong to the **sso-sign-in** feature, not ai-dock. By the final porcelain check they had
already been *committed away* by that other session and replaced by a further untracked
file (`apps/web/src/auth/LoginPage.a11y.spec.tsx`) — confirming an actively committing
concurrent writer rather than a stray edit. This Verifier ran only read-only
commands (`biome check` with no `--write` — its own output confirms "No fixes applied" —
`tsc --noEmit`, and `vitest`), so another session is writing to this working tree
concurrently. The added key is `auth.submitting`; no `aiDock.*` key was touched, so none
of the evidence above is affected. Flagged because a concurrent writer makes any future
sensor run's isolation check unreliable: **quiesce other sessions before the re-verify
round.**

Planned targets for the re-verify round (highest-risk *new* code in this diff, per the
gap ranking below): (1) `EditorSurface.applyRemoteScene`'s LWW tie-break, (2)
`AiDockClient.approve`'s 409-vs-200 branch, (3) `AiDock`'s `if (!canMutate) return null`
gate. `computeApprovalThreshold` is pre-existing and correctly out of scope.

**Sensor depth**: n/a (blocked)
**Result**: n/a — ❌ blocked by gate

---

## Code Quality

**NOT FORMALLY RUN** — `validate.md` §4 stops before the Code Quality Check on a gate
failure. Recorded below are observations made while gathering AC evidence, so they are
not lost; they are not a completed §6 pass.

| Principle | Status |
| --------- | ------ |
| Minimum code | ⚠️ Two unused artifacts — see below |
| Surgical changes | ✅ `permissions` on bootstrap left byte-for-byte unchanged; `EditorSurface`'s `forwardRef` conversion is backward compatible |
| No scope creep | ✅ No `ai-engine` route, schema, or behavior touched, exactly as Out of Scope requires |
| Matches patterns | ✅ `aiDockStore` mirrors `createSaveStatusStore`; `AiDockClient` mirrors `DiagramSyncClient`'s injectable `fetchImpl` + per-status branching; a11y spec mirrors `shell.a11y.spec.tsx` |
| Spec-anchored outcome check | ❌ 6 partial + 1 precision gap (table above) |
| Per-layer Coverage Expectation met | ⚠️ Domain/store/client layers are 1:1; the component layer misses several ACs (DOCK-04, 06, 20, 21) |
| Every test maps to a spec requirement | ✅ No unclaimed tests found in scope |
| Documented guidelines followed | ✅ `CLAUDE.md` — AD-008 respected (`packages/editor-adapter` is client-side; no server package gained an `@excalidraw/excalidraw` value import); AD-010's `applyRemote` reconciliation used instead of a remount |

**Unused artifacts (minor, not blockers):**

1. `AiDockClient.refreshScene()` (`apps/web/src/ai-dock/aiDockClient.ts:172-177`) is
   implemented and has two dedicated tests (`aiDockClient.spec.ts:279-308`), but **has no
   production consumer**: `DiagramEditorPage.handleApproved` (`DiagramEditorPage.tsx:88-93`)
   deliberately calls `DiagramSyncClient.bootstrap()` instead, to also resync the mutation
   queue's `baseRevision`. The choice is sound and documented at `DiagramEditorPage.tsx:30-36`,
   but it leaves T6's `refreshScene` as dead production code with live tests.
2. The `'expired'` phase (`aiDockStore.ts:17`) plus its `aiDock.status.expired` strings in
   both locales are never reached by any code path.

---

## Requirement Traceability Update

`spec.md` statuses are **not** advanced to Verified by this run — the gate blocked and 6
ACs are partially covered.

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| DOCK-01, 02, 03, 05, 07, 09, 11, 12, 13, 15, 16, 17, 19, 22, 23 | Pending | ⏸️ Evidence complete, awaiting gate green + sensor |
| DOCK-10 | Pending | ⚠️ Needs a stronger render assertion |
| DOCK-04, 06, 08, 14, 18, 20, 21 | Pending | ❌ Needs Fix (partial coverage) |

---

## Fix Plans

### Fix 1: Green the build gate (BLOCKER — not ai-dock's code)

- **Root cause**: `9b1efae` regenerated `docs/openapi.json` without running the Biome
  formatter over the output. Outside the ai-dock diff range.
- **Fix task**: run the repo formatter over `docs/openapi.json` and commit; consider making
  the openapi generation script format its own output so this cannot recur.
- **Priority**: Blocker (blocks every gate run, repo-wide)

### Fix 2: Cover DOCK-18's second half (Major)

- **Root cause**: Undo is verified only at the request-emission level. The spec's own
  Independent Test asks for a bootstrap-level check that content reverted and the revision
  *increased*.
- **Fix task**: extend `DiagramEditorPage.spec.tsx` with an undo leg — approve, then undo,
  then assert `updateSceneSpy`'s second call carries the pre-apply element ids and that the
  refreshed bootstrap revision is greater than the applied one.
- **Priority**: Major

### Fix 3: Cover DOCK-04, DOCK-06, DOCK-20, DOCK-21 (Major → Minor)

- **DOCK-04**: assert `submitButton.disabled === true` while phase is `submitting`/
  `awaiting_approval`/`approving`/`restoring` (a deferred-resolution `fetchImpl` makes the
  in-flight window observable).
- **DOCK-06**: assert all five preview headings render with their counts, not just `added`
  and `removed`.
- **DOCK-20**: add the two-sequential-approvals test — approve run A, approve run B, undo,
  assert the restore URL carries B's snapshot id.
- **DOCK-21**: assert keyboard reachability of the remaining four actions (summary toggle,
  approve, discard, undo).
- **Priority**: Major (DOCK-06, DOCK-20), Minor (DOCK-04, DOCK-21)

### Fix 4: Small precision items (Minor)

- **DOCK-08/DOCK-14**: assert the diagram revision is unchanged while `awaiting_approval`
  and after a discard.
- **DOCK-10**: re-assert the rendered error with a distinctive code (`provider_timeout`),
  so the test can distinguish interpolation from the literal fallback word.
- **Edge case >50**: disambiguate the spec sentence, then either add an `overflow-y: auto`
  container or amend the spec to say the remainder is intentionally dropped.
- **Dead code**: remove `refreshScene` (or wire it) and the unreachable `'expired'` phase,
  or document why they stay.
- **Priority**: Minor

---

## Summary

**Overall**: ❌ Not Ready

**Spec-anchored check**: 16/23 ACs matched their spec-defined outcome; 6 partial-coverage
gaps + 1 spec-precision gap
**Sensor**: not run (blocked by the gate, per validate.md §4)
**Gate**: ❌ `make lint` exits 1 — `docs/openapi.json` formatting, **outside this
feature's diff**. `make typecheck` + `make test-unit` pass: 896/896 tests, 0 failed.

**What works**: The product invariant this feature exists to deliver is genuinely and
strongly tested — nothing reaches the canvas without an explicit approval click, proven at
two independent layers (`AiDock.spec.tsx:150/157` on the callback, `DiagramEditorPage.spec.tsx:171/179`
on the actual `updateScene`), and it holds on the `requiresExplicitApproval: false` path,
which is exactly the auto-apply regression the Success Criteria demand a failing test for.
The 409 conflict path, the 429 rate-limit path with its 60s re-enable, the undo-failure
path, permission gating end-to-end from the server's `mutatePermissions` to a completely
absent DOM node, and AD-010's LWW canvas reconciliation are all cleanly anchored.

**Issues found**: One repo-wide blocker outside this feature (openapi formatting), and a
consistent pattern in the gaps — where an AC has two clauses ("emit X **and** the diagram
ends in state Y"), the emission is tested and the resulting state is not. DOCK-18, 14, 08
and 04 all fail on that same second clause.

**Next steps**: Route Fix 1 to green the gate, then Fixes 2–3, then re-dispatch the
Verifier for the sensor and Code Quality Check (iteration 1 of 3).
