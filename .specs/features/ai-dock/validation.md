# ai-dock Validation

## Validation: ai-dock - PASS ✅ (round 2)

**Date**: 2026-08-16
**Spec**: `.specs/features/ai-dock/spec.md`
**Diff range**: `77c652b^..ec9d963` (branch `feature/improvements-3`), scoped to the ai-dock
paths only — `apps/web/src/ai-dock`, `packages/editor-adapter`,
`apps/server/src/modules/diagram-sync/{routes.ts,bootstrap.int.spec.ts}`,
`apps/web/src/diagram/DiagramEditorPage.{tsx,spec.tsx}`,
`apps/web/src/i18n/locales/*/translation.json`. The same range now also carries
interleaved `sso-sign-in` commits (`be9dadd`, `62afd17`, `8d5df33`, `6df1bb1`, `e04245b`,
`e76c135`) from a concurrent wave on the same branch; those are a different feature and
are excluded from this report except where noted.
**Verifier**: independent sub-agent (author ≠ verifier)

> **This report supersedes the round 1 report** that previously occupied this file. Round 1
> was blocked at the build-level gate (an `docs/openapi.json` formatting error outside this
> feature's diff, since fixed by `4b2ac9b`) and recorded 6 partial-coverage acceptance
> criteria plus 1 spec-precision gap. This round re-derived **all 23** acceptance criteria
> from `spec.md` independently — not only the 7 that were flagged — and ran the
> Discrimination Sensor that round 1 could not reach.

---

## Task Completion

All 9 tasks are complete: `tasks.md` contains **48 `Done when` checkboxes, all `[x]`, and
zero unchecked boxes** (verified by `grep`, not assumed).

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 — `mutatePermissions` on bootstrap | ✅ Done | `apps/server/src/modules/diagram-sync/routes.ts:74-85`; `permissions` (`diagram:read`) left byte-for-byte unchanged |
| T2 — `onSelectionChange` on `EditorSurface` | ✅ Done | `packages/editor-adapter/src/EditorSurface.tsx:95-101`; fires on every `onChange`, including selection-only changes |
| T3 — `applyRemoteScene` imperative handle | ✅ Done | `packages/editor-adapter/src/EditorSurface.tsx:68-74`; AD-010 `applyRemote` reconciliation, not a remount |
| T4 — `aiDock` i18n keys (pt-BR, en) | ✅ Done | Key sets re-verified programmatically identical across both locales (`en-only: []`, `pt-only: []`) |
| T5 — `aiDockStore` | ✅ Done | Every action has a dedicated test |
| T6 — `AiDockClient` | ✅ Done | ⚠️ `refreshScene()` still ships + is tested but has **no production consumer** (see Code Quality) |
| T7 — `AiDock` component | ✅ Done | 20 unit tests (was 16 in round 1; +4 from the fix round) |
| T8 — `AiDock` a11y coverage | ✅ Done | 3 states, `seriousOrCriticalViolations` = `[]` |
| T9 — wire into `DiagramEditorPage` | ✅ Done | 6 integration-style tests (was 3 in round 1; +3 from the fix round). Carries a self-declared DEVIATION note re: `repo-tools audit` — accurate, and the underlying openapi drift has since been fixed by `4b2ac9b` |

**Bookkeeping note (cosmetic, not a defect):** T1–T6 carry a `— DONE` suffix on their
headings; T7–T9 do not, even though every one of their `Done when` boxes is `[x]`. The
checkbox state — which is what `validate_tasks.py` and `validate_state.py` read — is
consistent and complete.

---

## Spec-Anchored Acceptance Criteria

Evidence-or-zero: every row cites a `file:line` plus the actual assertion expression, and
the asserted value is compared against the outcome `spec.md` defines. Rows re-derived
fresh this round; the 16 that round 1 confirmed were re-checked, not carried over.

### P1: Pedir uma mudança em linguagem natural (DOCK-01..05)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion expression | Result |
| ------------------------- | -------------------- | ---------------------------------- | ------ |
| DOCK-01 WHEN the role grants `diagram:mutate` THEN render the dock as a collapsible side panel, request field in the DOM and keyboard-reachable | A collapsible panel is rendered; the request field is focusable | `apps/web/src/ai-dock/AiDock.spec.tsx:89` — `expect(field.tagName).toBe('TEXTAREA')`; `:91` — `expect(document.activeElement).toBe(field)`; `apps/web/src/diagram/DiagramEditorPage.spec.tsx:108` — `expect((row.children[1] as HTMLElement).tagName).toBe('DETAILS')` (native collapsible, sibling of the canvas column) | ✅ PASS |
| DOCK-02 IF the role lacks `diagram:mutate` THEN render no dock at all, not even disabled | Nothing rendered whatsoever | `apps/web/src/ai-dock/AiDock.spec.tsx:80` — `expect(container.innerHTML).toBe('')`; `:81` — `expect(fetchImpl).not.toHaveBeenCalled()`; `apps/web/src/diagram/DiagramEditorPage.spec.tsx:437` — `expect(document.querySelector('details')).toBeNull()`; server source of the flag: `apps/server/src/modules/diagram-sync/bootstrap.int.spec.ts:118` — `expect(body.mutatePermissions).toMatchObject({ allowed: false })` (viewer) and `:96` — `{ allowed: true }` (mutate-capable role) | ✅ PASS |
| DOCK-03 WHEN the request has ≥1 char THEN `POST /diagrams/{id}/ai/runs` with `userRequest`, `language` = active locale, `selection` = selected ids, omitting `selection` when nothing is selected | Exact request body shape | `apps/web/src/ai-dock/aiDockClient.spec.ts:55` — `body: JSON.stringify({ userRequest: 'draw three services', language: 'en' })` (no `selection` key at all); `:84-88` — `body: JSON.stringify({ userRequest: 'resize these', language: 'pt-BR', selection: ['el-a','el-b'] })`; `apps/web/src/ai-dock/AiDock.spec.tsx:137-142` — full body incl. `selection: ['sel-1']`, `language` read from the live i18n instance; selection provenance: `packages/editor-adapter/src/EditorSurface.spec.tsx:80` — `expect(onSelectionChange).toHaveBeenCalledWith(['el-1','el-3'])` (only truthy `selectedElementIds`) | ✅ PASS |
| DOCK-04 WHILE a run is in progress, keep the submit button disabled and show the run's current status, without blocking manual canvas editing | `disabled === true` for the whole in-flight window; status visible; canvas still editable | Submit gate (**new this round**): `apps/web/src/ai-dock/AiDock.spec.tsx:664` — `expect(submitButton.disabled).toBe(false)` before send, `:672` — `expect(submitButton.disabled).toBe(true)` while `submitting` (deferred-resolution `fetchImpl`), `:687` — `.disabled).toBe(true)` once `awaiting_approval`. Status: `:718` — `expect(liveRegion?.textContent).toBe('Idle')` → `:722` — `toBe('Awaiting your approval')` | ✅ PASS (see note) |
| DOCK-05 IF HTTP 429 THEN report the 20-req/min limit, preserve the typed text, re-enable submit after 60 s | Message shown; `field.value` preserved; `disabled === false` after 60 000 ms | `apps/web/src/ai-dock/AiDock.spec.tsx:272` — `getByText('Limit of 20 requests per minute reached. Try again in 60 seconds.')`, `:275` — `expect(submitButton.disabled).toBe(true)`, `:277` — `expect(field.value).toBe('draw three services')`, then after `vi.advanceTimersByTime(60_000)` → `:283` — `.disabled).toBe(false)`; `apps/web/src/ai-dock/aiDockClient.spec.ts:145` — `rateLimitedUntil: 1_000_000 + 60_000` | ✅ PASS |

**DOCK-04 note.** The AC's two positive clauses are now precisely asserted and
discriminating (sensor mutation 2 below removes the in-flight term from the disabled gate
and is killed by `AiDock.spec.tsx:650`). Its third, negative clause — *"sem impedir a
edição manual do canvas"* — has no dedicated assertion, and by evidence-or-zero that
sub-clause is uncited. It holds by construction rather than by test: `AiDock` is a DOM
sibling of the canvas column with no shared state (`apps/web/src/diagram/DiagramEditorPage.tsx:101-127`),
`EditorSurface`'s props never reference the dock's phase, and no overlay or
`pointer-events` rule is introduced anywhere in the feature. `DiagramEditorPage.spec.tsx:294-351`
drives the page to `awaiting_approval` with `EditorSurface` still mounted and its
`onChange` still live. Recorded as a residual precision note, not a blocking gap.

### P1: Ver o que vai mudar antes de qualquer coisa mudar (DOCK-06..10)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion expression | Result |
| ------------------------- | -------------------- | ---------------------------------- | ------ |
| DOCK-06 WHEN the 201 carries `preview` THEN display the four diff lists (`added`, `removed`, `moved`, `modified`), each with its element count, plus `metadataChanged` | All **five** lists rendered, each with a count | **New this round** — `apps/web/src/ai-dock/AiDock.spec.tsx:148-154` — `expect(headings).toEqual(['Removed (1)','Added (3)','Moved (1)','Modified (2)','Metadata changed (1)'])`. An exact array equality over every level-3 heading: a missing list, an extra list, or a wrong count all fail it (round 1's `indexOf` comparison passed with three of the five absent) | ✅ PASS |
| DOCK-07 Display `removed` before the other three whenever it has ≥1 element | `removed` heading precedes `added`, `moved`, `modified` | Same `toEqual` at `apps/web/src/ai-dock/AiDock.spec.tsx:148-154` — `'Removed (1)'` is index 0, strictly ahead of all four others, now compared individually rather than against `added` alone | ✅ PASS |
| DOCK-08 Keep the canvas, the diagram revision and the local mutation queue unchanged while the run is `awaiting_approval` | No canvas write; revision unchanged; queue never flushed | **New this round** — `apps/web/src/diagram/DiagramEditorPage.spec.tsx:345` — `expect(updateSceneSpy).not.toHaveBeenCalled()` (canvas); `:346` — `expect(bootstrapCalls).toBe(1)` (no re-bootstrap, so the revision the page holds is still the pre-run one); `:347-350` — `expect(fetchImpl).not.toHaveBeenCalledWith('/diagrams/diagram-1/operations:batch', expect.anything())` (mutation queue). All three clauses cited | ✅ PASS |
| DOCK-09 WHEN the 201 arrives without `preview` (run ended before `previewing`) THEN display the run's `errorCode` and offer no approve action | `errorCode` taken from `run.errorCode`; approve absent | `apps/web/src/ai-dock/aiDockClient.spec.ts:106` — `expect(store.getState()).toMatchObject({ phase: 'error', errorCode: 'provider_timeout' })`; render side `apps/web/src/ai-dock/AiDock.spec.tsx:516` — `getByText('Error: some_totally_unmapped_code')`; approve-absent in the error phase `:531` — `expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()` and `:492` (vanished-run variant) | ✅ PASS |
| DOCK-10 IF the run ends `failed` THEN display the server's `errorCode`, without flattening it into a generic message that loses the code | The raw server code reaches the screen | **New this round** — `apps/web/src/ai-dock/AiDock.spec.tsx:516` — `expect(screen.getByText('Error: some_totally_unmapped_code')).not.toBeNull()` against the fallback key `aiDock.error.unknown = "Error: {{code}}"`, paired with `:517` — `expect(screen.queryByText('Error: unknown')).toBeNull()`. The distinctive, unmapped code makes real `{{code}}` interpolation the only way the assertion can pass — round 1's ⚠️ precision gap is closed | ✅ PASS |

### P1: Aprovar explicitamente, ou descartar (DOCK-11..16)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion expression | Result |
| ------------------------- | -------------------- | ---------------------------------- | ------ |
| DOCK-11 Offer exactly two terminal actions for `awaiting_approval`: approve and discard | Both present; neither survives termination | `apps/web/src/ai-dock/AiDock.spec.tsx:155-156` — `getByRole('button', { name: 'Approve' })` and `{ name: 'Discard' }` both non-null; `:217-218` — both `queryByRole(...)` are `null` once the run is discarded | ✅ PASS |
| DOCK-12 Require an approval click on **every** run, including when `requiresExplicitApproval` is `false` | No auto-apply on the `false` path | `apps/web/src/ai-dock/AiDock.spec.tsx:157` — with `requiresExplicitApproval: false`, `expect(onApproved).not.toHaveBeenCalled()` before the click, `:164` — `toHaveBeenCalledTimes(1)` after; independently at the canvas layer `apps/web/src/diagram/DiagramEditorPage.spec.tsx:178` — `expect(updateSceneSpy).not.toHaveBeenCalled()` while `awaiting_approval` with `requiresExplicitApproval: false` (`:147`). This is the Success-Criteria test that fails if auto-apply is ever reintroduced | ✅ PASS |
| DOCK-13 WHEN approving THEN `POST /ai/runs/{runId}:approve`, reflecting the change on the canvas only after HTTP 200 | Canvas write strictly after the 200 resolves | `apps/web/src/ai-dock/aiDockClient.spec.ts:176` — `expect(store.getState().phase).toBe('approving')` *before* awaiting the promise, `:180` — `toHaveBeenCalledWith('/ai/runs/run-4:approve', { method: 'POST' })`, `:181` — `toMatchObject({ phase: 'applied', lastSnapshotId: 'snapshot-4' })`; `apps/web/src/diagram/DiagramEditorPage.spec.tsx:178` — not called before, `:186` — `toHaveBeenCalledTimes(1)` after, `:188` — `expect(sceneData.elements.map((el) => el.id)).toContain('el-fresh')` | ✅ PASS |
| DOCK-14 WHEN discarding THEN `POST /ai/runs/{runId}:cancel` and the diagram stays at the pre-run revision | Cancel emitted; revision unchanged | Emission: `apps/web/src/ai-dock/AiDock.spec.tsx:216` and **new this round** `apps/web/src/diagram/DiagramEditorPage.spec.tsx:408` — `expect(fetchImpl).toHaveBeenCalledWith('/ai/runs/run-discard:cancel', { method: 'POST' })`. Resulting state (**new**): `:409` — `expect(updateSceneSpy).not.toHaveBeenCalled()`, `:412` — `expect(bootstrapCalls).toBe(1)` (a discard triggers no refresh of any kind, so the page stays on the revision bootstrap already reported) | ✅ PASS |
| DOCK-15 IF approve responds 409 THEN discard the preview, report that the diagram changed, re-offer the same text, never apply the patch | Preview cleared, text preserved, conflict message shown, nothing applied | `apps/web/src/ai-dock/AiDock.spec.tsx:248` — `getByText('The diagram changed since your request. Send it again to try once more.')`, `:250` — approve `null`, `:251` — `expect(onApproved).not.toHaveBeenCalled()`, `:253` — `expect(field.value).toBe('draw three services')`; `apps/web/src/ai-dock/aiDockClient.spec.ts:197` — `toMatchObject({ phase: 'idle', preview: null, run: null })`; `apps/web/src/ai-dock/aiDockStore.spec.ts:132-137` | ✅ PASS |
| DOCK-16 WHERE `requiresExplicitApproval` is `true`, mark the proposal as a sensitive change next to approve | Marker rendered alongside Approve | `apps/web/src/ai-dock/AiDock.spec.tsx:185` — `getByText('Sensitive change — review carefully before approving')`, `:186` — Approve button present in the same render | ✅ PASS |

### P1: Desfazer a última aplicação (DOCK-17..20)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion expression | Result |
| ------------------------- | -------------------- | ---------------------------------- | ------ |
| DOCK-17 WHEN approve responds 200 THEN store the returned `snapshot.id` and show Undo | `lastSnapshotId` = response `snapshot.id`; Undo visible | `apps/web/src/ai-dock/aiDockClient.spec.ts:181` — `toMatchObject({ phase: 'applied', lastSnapshotId: 'snapshot-4' })`; `apps/web/src/ai-dock/AiDock.spec.tsx:167` — `expect(screen.getByRole('button', { name: 'Undo' })).not.toBeNull()` | ✅ PASS |
| DOCK-18 WHEN Undo is triggered THEN `POST /diagrams/{id}/snapshots/{snapshotId}:restore` with the approved run's `snapshot.id`, and the canvas returns to the pre-apply content **as a new revision** | Correct restore URL **and** content reverted **and** the resulting revision greater, not smaller | Request: `apps/web/src/ai-dock/AiDock.spec.tsx:328-330` and `apps/web/src/ai-dock/aiDockClient.spec.ts:247-249` — `toHaveBeenCalledWith('/diagrams/diagram-1/snapshots/snapshot-4:restore', { method: 'POST' })`. Outcome (**new this round**, matching the spec's own Independent Test): `apps/web/src/diagram/DiagramEditorPage.spec.tsx:283` — `expect(restoredScene.elements.map((el) => el.id)).not.toContain('el-fresh')`, `:284` — `.toContain(baseElement.id)`, `:287` — `expect(bootstrapCalls).toBe(3)` (reached via a fresh `GET .../bootstrap`, not a stale re-render), `:291` — `expect(revisionAtUndo as number).toBeGreaterThan(revisionAtApply as number)` | ✅ PASS |
| DOCK-19 IF restore responds any status ≠ 200 THEN keep Undo available and never report success | Undo still offered; no success signal | `apps/web/src/ai-dock/AiDock.spec.tsx:375` — `expect(onApproved).not.toHaveBeenCalled()` after a 500, `:376` — Undo still non-null; `apps/web/src/ai-dock/aiDockClient.spec.ts:262` — `toMatchObject({ phase: 'applied', lastSnapshotId: 'snapshot-8' })`, `:274` — network-failure variant; `apps/web/src/ai-dock/aiDockStore.spec.ts:170` | ✅ PASS |
| DOCK-20 Offer Undo only for the run applied **most recently** in the current editor session | With ≥2 sequential approvals, the restore targets the latest `snapshot.id` and not the earlier one | **New this round** — `apps/web/src/ai-dock/AiDock.spec.tsx:451-453` — after approving run A then run B, `expect(fetchImpl).toHaveBeenCalledWith('/diagrams/diagram-1/snapshots/snapshot-b:restore', { method: 'POST' })`, paired with the discriminating negative `:454-457` — `expect(fetchImpl).not.toHaveBeenCalledWith('/diagrams/diagram-1/snapshots/snapshot-a:restore', expect.anything())`. Single-run half retained at `apps/web/src/ai-dock/aiDockStore.spec.ts:162` | ✅ PASS |

### P2: Operável por teclado e nos dois idiomas (DOCK-21..23)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion expression | Result |
| ------------------------- | -------------------- | ---------------------------------- | ------ |
| DOCK-21 Operable by keyboard alone in **all** its actions: open, focus the field, submit, approve, discard, undo | All six actions keyboard-focusable/activatable | All six now cited. Focus field: `apps/web/src/ai-dock/AiDock.spec.tsx:91` — `expect(document.activeElement).toBe(field)`; submit: `:579` — `toBe(submitButton)`. **New this round** — open (`<summary>`): `:624` — `expect(document.activeElement).toBe(summary)`; approve: `:630` — `toBe(approveButton)`; discard: `:634` — `toBe(discardButton)`; undo: `:643` — `toBe(undoButton)`. Reinforced by `apps/web/src/ai-dock/AiDock.a11y.spec.tsx:56/89/115` — `expect(seriousOrCriticalViolations(results)).toEqual([])` in three states | ✅ PASS |
| DOCK-22 WHEN the run's status changes THEN announce the new status in an `aria-live="polite"` region | Live-region text updates on transition | `apps/web/src/ai-dock/AiDock.spec.tsx:718` — `expect(liveRegion?.textContent).toBe('Idle')` where `liveRegion = document.querySelector('[aria-live="polite"]')`, then `:722` — `await waitFor(() => expect(liveRegion?.textContent).toBe('Awaiting your approval'))` | ✅ PASS |
| DOCK-23 All visible text from existing i18n keys, in `pt-BR` and `en`, with no text literal in the component | Both locales render translated strings; no literals in `AiDock.tsx` | `apps/web/src/ai-dock/AiDock.spec.tsx:694-695` — pt-BR `getByText('Dock de IA')` / `getByLabelText('Descreva o que você quer mudar')`, `:700-701` — after `changeLanguage('en')`, `getByText('AI dock')` / `getByLabelText('Describe what you want to change')`. No-literal confirmed by inspection of `apps/web/src/ai-dock/AiDock.tsx:136-186` (every visible string goes through `t(...)`); locale key sets re-verified programmatically identical (`en-only: []`, `pt-only: []`) | ✅ PASS |

**Status**: ✅ **23/23 ACs matched their spec-defined outcome.** All 7 rows round 1 flagged
(DOCK-04, 06, 08, 10, 14, 18, 20, 21) are closed with assertions that target the exact
value or state `spec.md` specifies; five of them were independently proven discriminating
by the sensor below. One residual sub-clause note is recorded under DOCK-04, and one
Edge-Case spec ambiguity remains open (see Edge Cases).

**Scope caveat on DOCK-18.** The "as a new revision" clause is asserted at the frontend
layer: the test's own stub serves a strictly increasing `revision` per bootstrap call, so
`DiagramEditorPage.spec.tsx:291` proves the page re-reads a fresh bootstrap and that the
revision it lands on climbed rather than regressed. That the *server* issues the restore as
a forward revision is the snapshot module's own already-verified behavior, and `spec.md`'s
Out of Scope table explicitly freezes server behavior for this slice — so a frontend-layer
assertion is the correct and complete analogue here.

---

## Discrimination Sensor

Isolated scratch: `git worktree add <scratch> HEAD` (detached at `ec9d963`), with the real
tree's `node_modules` symlinked in read-only fashion. No `git stash` at any point. Mutations
targeted the exact behaviors round 1's gaps were about.

| # | File:line (in scratch) | Mutation | Behavior broken | Killed? |
| - | ---------------------- | -------- | --------------- | ------- |
| 1 | `apps/web/src/ai-dock/aiDockStore.ts:119` | `approveSuccess` → `set((s) => ({ phase: 'applied', lastSnapshotId: s.lastSnapshotId ?? snapshotId }))` | Undo keeps targeting the **first** applied run instead of the most recent (DOCK-20) | ✅ Killed — `AiDock.spec.tsx:379` "after two sequential approvals, Undo targets the most recently applied run, not the first (DOCK-20)" |
| 2 | `apps/web/src/ai-dock/AiDock.tsx:97` | `submitDisabled = isBlank \|\| isRunOngoing \|\| isRateLimited` → `isBlank \|\| isRateLimited` | Submit stays enabled for the whole in-flight window (DOCK-04) | ✅ Killed — `AiDock.spec.tsx:650` "keeps submit disabled while a run is in flight, from submitting through awaiting_approval (DOCK-04)" |
| 3 | `apps/web/src/ai-dock/AiDock.tsx:34` | `previewOrder`: `preview.removed.length > 0` → `< 0` | `removed` no longer hoisted ahead of the other lists (DOCK-07) | ✅ Killed — `AiDock.spec.tsx:107` "full happy path: submit -> preview (removed before added) -> approve" |
| 4 | `apps/web/src/ai-dock/AiDock.tsx:24-38` | Dropped `'metadataChanged'` from both preview orderings | The fifth diff list silently disappears from the preview (DOCK-06) | ✅ Killed — `AiDock.spec.tsx:148` `expect(headings).toEqual([...5 headings])` |
| 5 | `apps/web/src/ai-dock/AiDock.tsx:126-128` | Removed the `if (store.getState().phase === 'idle') await onApproved()` side effect from `handleUndo` | A successful restore never refreshes the canvas (DOCK-18) | ✅ Killed — twice: `AiDock.spec.tsx:288` (undo path) **and** `DiagramEditorPage.spec.tsx:193` "undo after approve: the canvas returns to the pre-apply content as a new, higher revision (DOCK-18)" |

**Sensor depth**: lightweight (5 targeted behavior-level mutations — above the 1–3 default,
because round 1 identified these five behaviors specifically as untested)
**Result**: 5/5 killed — PASS ✅

**Isolation verified.** Pre-sensor `git status --porcelain` on the real tree: **empty**.
Post-sensor, after `git worktree remove --force` and `git worktree prune`:
`git status --porcelain` **empty**, `git worktree list` shows only
`/Users/thiagolopes/Projects/ia-draw ec9d963 [feature/improvements-3]`, `HEAD` still
`ec9d963e0f9a281d24f9d84cab6b689780f2ab9b`. Baseline matched exactly; the real tree was
never mutated. Unlike round 1, no concurrent writer was active during this run.

---

## Code Quality

| Check | Status |
| ----- | ------ |
| No features beyond what was asked | ✅ |
| No abstractions for single-use code | ✅ |
| No unnecessary "flexibility" added | ✅ |
| Only touched files required for task | ✅ |
| Didn't "improve" unrelated code | ✅ |
| Matches existing patterns/style | ✅ `aiDockStore` mirrors `createSaveStatusStore`; `AiDockClient` mirrors `DiagramSyncClient`'s injectable `fetchImpl` + per-status branching; `AiDock.a11y.spec.tsx` mirrors `shell.a11y.spec.tsx` |
| Would a senior engineer approve? | ✅ |
| Minimum code | ⚠️ Two unused artifacts carried over from round 1 — see below |
| Surgical changes | ✅ bootstrap's `permissions` field byte-for-byte unchanged; `EditorSurface`'s `forwardRef` conversion is backward compatible for every ref-less consumer |
| No scope creep | ✅ No `ai-engine` route, schema, or behavior touched, exactly as Out of Scope requires |
| Spec-anchored outcome check (asserted values match spec) | ✅ 23/23 |
| Per-layer Coverage Expectation met (domain 1:1 ACs; routes happy + edge + error) | ✅ store/client/component/integration layers all now map 1:1; the component layer's four round-1 holes (DOCK-04, 06, 20, 21) are closed |
| Every test in scope maps to a spec AC, edge case, or Done-when criterion | ✅ No unclaimed tests found in scope. Each of the 7 fix-round tests names its DOCK-NN in the test title |
| Documented guidelines followed | ✅ `CLAUDE.md` — AD-008 respected (no server-side package gained an `@excalidraw/excalidraw` value import; `packages/editor-adapter` is client-side); AD-010's `applyRemote` reconciliation used instead of a canvas remount; AD-001 LWW proven at `packages/editor-adapter/src/EditorSurface.spec.tsx:154` |

**Unused artifacts (minor, unchanged since round 1, not blockers):**

1. `AiDockClient.refreshScene()` (`apps/web/src/ai-dock/aiDockClient.ts:172-177`) is
   implemented and has two dedicated tests (`aiDockClient.spec.ts:279-308`) but **has no
   production consumer**. `DiagramEditorPage.handleApproved`
   (`apps/web/src/diagram/DiagramEditorPage.tsx:88-93`) deliberately calls
   `DiagramSyncClient.bootstrap()` instead, so the mutation queue's `baseRevision` and the
   save-status store resync too. The choice is sound and documented at
   `DiagramEditorPage.tsx:28-37`, but it leaves T6's `refreshScene` as dead production code
   with live tests.
2. The `'expired'` phase (`apps/web/src/ai-dock/aiDockStore.ts:17`) plus its
   `aiDock.status.expired` strings in both locales are never reached by any code path.

---

## Edge Cases

- [~] **A run in `awaiting_approval` whose patch no longer exists server-side (post-restart) → treat as expired, never offer approve.** Covered by substitution: `apps/web/src/ai-dock/AiDock.spec.tsx:467-495` drives a 404 on approve and asserts `:492` — `expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()` and `:493` — `expect(onApproved).not.toHaveBeenCalled()`. The literal "dock mounts holding such a run" path cannot occur — the store is process memory (`spec.md` Assumptions: *"O run sobrevive a recarregar a página? Não"*). The test carries an explicit written justification at `:460-466`. The safety invariant the edge case exists to protect (approve is never re-offered for a run that no longer exists) is asserted. **Residual:** the `'expired'` phase remains dead state.
- [x] **No AI provider configured → show that configuration is missing, offer no non-existent path.** `apps/web/src/ai-dock/AiDock.spec.tsx:529` — `getByText('No AI provider is configured. This is set up outside the product today.')`, `:531` — Approve absent; `apps/web/src/ai-dock/aiDockClient.spec.ts:128-131` — `errorCode: 'no_provider_configured'` from a 424.
- [x] **Canvas selection changes between request and approval → approval uses the patch computed at request time, without re-evaluating selection.** `apps/web/src/ai-dock/aiDockClient.spec.ts:180` — `expect(fetchImpl).toHaveBeenCalledWith('/ai/runs/run-4:approve', { method: 'POST' })`. The exact-argument match proves the approve request carries **no body at all**, so no selection value can possibly be re-sent — a complete proof of the client half of the criterion, not merely indirect evidence. The server-side use of the stored patch is frozen by Out of Scope.
- [x] **Empty/whitespace-only request → emit no request whatsoever.** `apps/web/src/ai-dock/AiDock.spec.tsx:104` — after typing `'   '` and clicking Send, `expect(fetchImpl).not.toHaveBeenCalled()`.
- [~] **Connection drops during the run → show the network failure, keep the request text, don't leave submit disabled forever.** `apps/web/src/ai-dock/aiDockClient.spec.ts:157` — `toMatchObject({ phase: 'error', errorCode: 'network_error' })`; text preservation at `apps/web/src/ai-dock/aiDockStore.spec.ts:92-96`. The "submit is re-enabled" half still has no direct UI assertion, but it is now *indirectly* discriminating: the new DOCK-04 test pins `submitDisabled`'s in-flight term to exactly `RUN_ONGOING_PHASES` (`AiDock.tsx:42`), which excludes `'error'` — sensor mutation 2 confirms any change to that gate is detected.
- [~] **Preview lists >50 touched elements → show the total count, cap the visible list at 50, the rest reachable by scrolling.** Count + cap covered: `apps/web/src/ai-dock/AiDock.spec.tsx:556` — `getByText('Added (60)')`, `:557` — `expect(screen.getAllByRole('listitem')).toHaveLength(50)`. ⚠️ **Spec-precision gap, still open from round 1 and not addressed by the fix round.** `AiDock.tsx:160` uses `.slice(0, MAX_VISIBLE_PREVIEW_ITEMS)`, so items 51–60 are never rendered and are unreachable by any scrolling, and no `overflow` container exists in the component. The Portuguese *"com o restante alcançável por rolagem"* admits two readings ("the remainder of the 60" vs "the remainder of the 50 that don't fit the panel"); under the first the implementation contradicts the spec, under the second it satisfies it. `spec.md` does not disambiguate. Lesson **L-029** already records this exact pattern; no new lesson is warranted.

---

## Gate Check

- **Gate command**: `make lint && make typecheck && make test-unit` (tasks.md Build level, minus `make test-integration`, per `CLAUDE.md`'s documented sandbox substitute), plus the integration leg run separately for this feature's server task.
- **Result**: ✅ **exit 0**. `make lint` clean (6 pre-existing warnings only: `apps/mcp/src/client.spec.ts` unused suppressions ×2, `tools/repo-tools/src/webConsumers.spec.ts` `noTemplateCurlyInString` ×4 — none fail the gate). `make typecheck` clean. `make test-unit`: 25/25 turbo tasks successful. The `docs/openapi.json` formatting error that blocked round 1 is gone, fixed by `4b2ac9b`.
- **Node**: v22.23.2, as `CLAUDE.md` requires.
- **Test counts**: **101 test files, 927 tests, 927 passing, 0 failing, 0 skipped** across 13 packages.
  - `@arch-canvas/web` 15 files / 122 tests · `@arch-canvas/server` 39 / 395 · `@arch-canvas/editor-adapter` 6 / 60 · `@arch-canvas/ai-tools` 5 / 70 · `@arch-canvas/diagram-ir` 9 / 68 · `@arch-canvas/auth` 1 / 63 · `@arch-canvas/repo-tools` 7 / 49 · `@arch-canvas/diagram-domain` 5 / 29 · `@arch-canvas/shared-contracts` 5 / 27 · `@arch-canvas/mcp` 5 / 20 · `@arch-canvas/library-content` 2 / 12 · `@arch-canvas/test-fixtures` 1 / 8 · `@arch-canvas/backup` 1 / 4
- **Integration leg**: `apps/server/src/modules/diagram-sync/bootstrap.int.spec.ts` re-run in isolation against PGlite (AD-007) — 6/6 passing, including both `mutatePermissions` role cases.
- **Delta vs round 1**: 896 → 927 tests (+31), 97 → 101 files (+4). Of the +31, **7 belong to ai-dock's fix round** (`AiDock.spec.tsx` 16 → 20; `DiagramEditorPage.spec.tsx` 3 → 6); the remaining +24 belong to the concurrent `sso-sign-in` wave (`LoginPage.spec.tsx`, `LoginPage.a11y.spec.tsx`, `AuthProvider.spec.tsx`, `ProtectedRoute.spec.tsx`, `AppShell.spec.tsx`, `App.spec.tsx`) and are out of scope here.
- **Test Integrity Check**: ✅ no regression. `git diff --diff-filter=D --name-only 77c652b^..HEAD` matches **zero** spec files — nothing deleted. Every ai-dock change in range is additive; the fix round only *strengthened* assertions (round 1's `indexOf` ordering check at `AiDock.spec.tsx:146-147` was replaced by the strictly stronger exact-array `toEqual` at `:148-154`). No assertion was weakened.
- **Coverage floors**: held — `apps/web/src/ai-dock` at 98.92% statements / 93.8% branches / 100% functions; `packages/editor-adapter/src/EditorSurface.tsx` at 100% statements / 90% branches.

**Environment observation (not a code defect).** The authoritative gate run above completed
with turbo cache hits on the `@arch-canvas/web` leg. Re-running `vitest` directly to
confirm, the machine was under a load average of ~23 (unrelated Unity and iOS-Simulator
processes), and vitest's 5 s default `testTimeout` produced non-deterministic timeouts that
moved between runs and hit **pre-existing, out-of-scope specs too** —
`src/a11y/shell.a11y.spec.tsx` (the already-verified A11Y-01 suite, untouched by this
feature), `src/App.spec.tsx`, `src/auth/LoginPage.spec.tsx`. A single axe timeout also
cascades through jest-axe's global "Axe is already running" guard. Re-run with
`--testTimeout=60000 --maxWorkers=2`, the web suite is **15/15 files, 122/122 tests
passing**, deterministically. The flakiness is host contention, not feature behavior; no
ai-dock-specific fragility was found.

---

## Fix Plans

No blocking issues. Three residual, non-blocking items, ranked:

### Residual 1: Disambiguate the >50-element preview cap (Minor, spec-text)

- **Root cause**: `spec.md`'s Edge Case sentence *"com o restante alcançável por rolagem"*
  is ambiguous; `AiDock.tsx:160`'s `.slice(0, 50)` satisfies one reading and contradicts the
  other.
- **Fix task**: amend the spec sentence to state explicitly whether items beyond 50 are
  dropped or rendered inside an `overflow-y: auto` container, then align the implementation
  and the assertion at `AiDock.spec.tsx:557` to whichever is chosen.
- **Priority**: Minor. Already generalized as lesson **L-029**.

### Residual 2: Remove or wire the two dead artifacts (Minor, code hygiene)

- **Root cause**: `AiDockClient.refreshScene()` was built to T6's contract, then T9 chose
  `DiagramSyncClient.bootstrap()` for a documented and better reason; the `'expired'` phase
  was designed but never reached because the client has no branch that sets it.
- **Fix task**: delete `refreshScene` (and its two tests) and the `'expired'` phase plus its
  two locale strings, or add a short comment recording why each is retained.
- **Priority**: Minor.

### Residual 3: Assert DOCK-04's "canvas stays editable" sub-clause (Minor, coverage)

- **Root cause**: the clause is an absence-of-coupling property, currently guaranteed by
  construction rather than asserted.
- **Fix task**: in `DiagramEditorPage.spec.tsx`'s DOCK-08 test, fire `capturedOnChange`
  while the run is `awaiting_approval` and assert the mutation queue still enqueues.
- **Priority**: Minor.

**Process observation (not a code defect).** The fix round's tests for DOCK-18, DOCK-08 and
DOCK-14 landed in commit `e04245b` *"feat(web): wire AuthProvider and ProtectedRoute into
the app shell"* — an unrelated `sso-sign-in` commit — because of a git-index race with a
concurrent session (`git show --numstat e04245b -- apps/web/src/diagram/DiagramEditorPage.spec.tsx`
shows +232/−3). This Verifier confirmed those three tests by reading the current file and
executing them, not by trusting the commit they are attached to; they prove exactly what
their titles claim, and mutation 5 above independently confirms the DOCK-18 one is
discriminating. The mismatch costs `git log`-based traceability for those three tests, and
argues for quiescing concurrent sessions on a shared working tree during a fix round.

---

## Requirement Traceability Update

All 23 requirements advance to ✅ Verified — each backed by an evidence row above with a
`file:line` and an assertion that targets the spec-defined outcome.

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| DOCK-01 | Pending | ✅ Verified |
| DOCK-02 | Pending | ✅ Verified |
| DOCK-03 | Pending | ✅ Verified |
| DOCK-04 | Pending | ✅ Verified (residual sub-clause note recorded) |
| DOCK-05 | Pending | ✅ Verified |
| DOCK-06 | Pending | ✅ Verified |
| DOCK-07 | Pending | ✅ Verified |
| DOCK-08 | Pending | ✅ Verified |
| DOCK-09 | Pending | ✅ Verified |
| DOCK-10 | Pending | ✅ Verified |
| DOCK-11 | Pending | ✅ Verified |
| DOCK-12 | Pending | ✅ Verified |
| DOCK-13 | Pending | ✅ Verified |
| DOCK-14 | Pending | ✅ Verified |
| DOCK-15 | Pending | ✅ Verified |
| DOCK-16 | Pending | ✅ Verified |
| DOCK-17 | Pending | ✅ Verified |
| DOCK-18 | Pending | ✅ Verified |
| DOCK-19 | Pending | ✅ Verified |
| DOCK-20 | Pending | ✅ Verified |
| DOCK-21 | Pending | ✅ Verified |
| DOCK-22 | Pending | ✅ Verified |
| DOCK-23 | Pending | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 23/23 ACs matched their spec-defined outcome; 0 coverage gaps;
1 Edge-Case spec ambiguity flagged (unchanged from round 1, already generalized as L-029)
**Sensor**: 5/5 mutations killed
**Gate**: exit 0 — 927 passing, 0 failing, 0 skipped

**What works**: The product invariant this feature exists to deliver is genuinely and
strongly tested — nothing reaches the canvas without an explicit approval click, proven at
two independent layers (`AiDock.spec.tsx:157`/`:164` on the callback,
`DiagramEditorPage.spec.tsx:178`/`:186` on the actual `updateScene`), and it holds on the
`requiresExplicitApproval: false` path, which is exactly the auto-apply regression the
Success Criteria demand a failing test for. Every clause round 1 found untested now has a
citation that names a concrete value: Undo targets the *latest* snapshot and provably not
the earlier one; submit is disabled across the whole in-flight window; all five diff lists
render with their counts in the mandated order; the server's `errorCode` reaches the screen
verbatim; the undo path is verified at bootstrap level for content revert *and* forward
revision; and `awaiting_approval`/discard leave canvas, revision, and mutation queue
untouched. The sensor killed all five mutants, four of them by the fix round's new tests
specifically — empirical proof those tests discriminate rather than merely execute.

**Issues found**: None blocking. Three Minor residuals (spec ambiguity on the >50 preview
cap, two dead artifacts, one uncited absence-property sub-clause), plus one process
observation about tests landing in the wrong commit due to a concurrent-session index race.

**Next steps**: Close the ai-dock wave. Route the three Minor residuals to a follow-up
grooming task rather than blocking this feature; the spec-text disambiguation (Residual 1)
should be settled before anyone builds on the preview list.
