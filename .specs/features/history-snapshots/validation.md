# Validation Report — history-snapshots (R6)

## Validation: history-snapshots - PASS ✅

**Verdict: PASS**

**Post-report update:** Gap #1 (surviving `isEmptyDiff` mutant) was fixed in commit `966c9cd`
(`test(history): cover mixed-shape diff to kill isEmptyDiff mutant`) — a mixed-shape diff test
case was added to `DiffView.spec.tsx`. Re-ran the same mutation (`.every` → `.some`) directly:
the new test now fails against the mutant and passes against the original, confirming the mutant
is killed. Gaps #2 and #3 (Edge Case 1's out-of-order-response guard, and Edge Case 2's literal
"another tab" framing) were left as-is — both informational/low-severity per the Verifier's own
ranking, not required for this feature's PASS.

Verified independently (no memory of implementing this feature) against
`.specs/features/history-snapshots/spec.md` (SNAP-01..16) and `tasks.md` (T1-T6), commit range
`c78864d..db7bad8` (7 commits) in worktree
`/Users/thiagolopes/Projects/ia-draw/.claude/worktrees/r6-history-snapshots`.

- 16/16 acceptance criteria have located `file:line` test evidence with assertions matching the
  spec's stated expected outcome.
- 3/4 Edge Cases have direct tests; 1 has no direct test (see Gap #2).
- Discrimination sensor: 6 mutations applied, 5 killed, **1 survived** (see Gap #1).
- Gate: `pnpm --filter @arch-canvas/web run test:unit` → 278/278 tests, 31/31 files passed.
  `pnpm --filter @arch-canvas/web run typecheck` → clean. `pnpm -w exec biome check
  apps/web/src/history/ apps/web/src/diagram/` → clean, no fixes. Worktree confirmed clean
  (`git status --porcelain` empty) before and after all mutation testing.

---

## Per-SNAP-NN evidence table

| ID | Requirement (summary) | Evidence (file:line) | Covered | Notes |
|----|------------------------|------------------------|---------|-------|
| SNAP-01 | List via GET, kind label + name + date, most-recent-first | `apps/web/src/history/HistoryPanel.spec.tsx:43-67` (mixed kinds: named/auto/pre_ai, asserts `Automático`/`Antes da edição por IA` labels + date text), `:69-96` (null-name named snapshot → "Snapshot sem nome"); `apps/web/src/history/snapshotClient.spec.ts:13-39` | Yes | Test exercises 3 of 5 kinds plus the null-name branch; label logic in `snapshotLabel.ts:11-18` verified end-to-end |
| SNAP-02 | Create action gated on `diagram:mutate` | `HistoryPanel.spec.tsx:98-114` (hidden, false), `:116-132` (visible, true) | Yes | |
| SNAP-03 | Create with name → POST `{name}`, insert at top from 201, no extra GET | `HistoryPanel.spec.tsx:134-177` (asserts `getCalls === 1`, row[0] contains new name); `snapshotClient.spec.ts:52-75` | Yes | |
| SNAP-04 | Create without name → POST omits `name` field entirely | `HistoryPanel.spec.tsx:179-208` (asserts `init.body === JSON.stringify({})`); `snapshotClient.spec.ts:77-96` (no-name) and `:98-117` (whitespace-only name → also omitted) | Yes | Explicitly checks omission, not `name: ""` |
| SNAP-05 | Empty list → empty-state explanation | `HistoryPanel.spec.tsx:234-254` | Yes | |
| SNAP-06 | Restore confirmation dialog explicitly names "new revision, nothing deleted" | `HistoryPanel.spec.tsx:313-336` (exact Portuguese sentence asserted); `RestoreConfirmDialog.spec.tsx:73-81` | Yes | Exact wording checked in both places |
| SNAP-07 | `clientMutationId` generated client-side (`crypto.randomUUID()`) sent with restore | `HistoryPanel.spec.tsx:338-371` (regex `/^[0-9a-f-]{36}$/` on request body); `snapshotClient.spec.ts:130-152` | Yes | |
| SNAP-08 | 200 → apply via `applyRemoteScene`, show new `currentRevision` | `HistoryPanel.spec.tsx:368` (`"Restaurado. Nova revisão: 9."`); `apps/web/src/diagram/DiagramEditorPage.spec.tsx:515-578` (asserts `updateSceneSpy` called once with the restored element, `bootstrapCalls === 2`, confirming the *second* bootstrap — the post-restore one — feeds `applyRemoteScene`) | Yes | See deviation assessment below |
| SNAP-09 | 404 → "snapshot no longer exists", relist | `HistoryPanel.spec.tsx:373-405` (asserts exact message, `onRestored` NOT called, `listCalls` goes from 1→2) | Yes | |
| SNAP-10 | Restore action hidden (not disabled) without `diagram:mutate` | `HistoryPanel.spec.tsx:295-311` (`screen.queryByText('Restaurar')` is null — element absent from DOM, not `disabled`) | Yes | |
| SNAP-11 | Compare → GET diff, 4 categorized lists by `elementId` | `apps/web/src/history/DiffView.spec.tsx:32-68`; `snapshotClient.spec.ts:200-221` | Yes | |
| SNAP-12 | 4 empty lists → "no structural changes" message | `DiffView.spec.tsx:70-95` | Yes | |
| SNAP-13 | 404 → server's own `title` message shown verbatim, panel not broken | `DiffView.spec.tsx:97-121` (asserts exact server string, and that the Comparar button is still present after); `snapshotClient.spec.ts:223-239` | Yes | |
| SNAP-14 | All actions keyboard-reachable | `HistoryPanel.spec.tsx:500-522` (`.focus()`/`activeElement` on create + restore buttons); `RestoreConfirmDialog.spec.tsx:106-116` (confirm/cancel) | Yes | No full Tab-sequence simulation exists (consistent with this repo's established convention in `ai-dock`/`workspace-navigation` — individual `.focus()` assertions on native `<button>`/`<select>`/`<input>` elements, which are inherently keyboard-operable) |
| SNAP-15 | Create/restore result announced in `aria-live="polite"` | `HistoryPanel.spec.tsx:524-552` (asserts `aria-live="polite"` attribute directly on the region, and its text content after a successful restore) | Yes | Only the restore-success path is asserted against the literal `aria-live` attribute; create-success/failure and restore-failure paths are asserted via `findByText` only (text does land inside the same single `aria-live` region structurally, since there is exactly one `announcement` state/one region in the component, but this isn't independently re-asserted per path) |
| SNAP-16 | All visible text from i18n keys, `pt-BR` + `en` parity | `apps/web/src/diagram/DiagramEditorPage.spec.tsx:580-617` (mid-session `i18n.changeLanguage('en')`, re-asserts toggle label and empty-state text in English); locale-key-set diff (see below) | Yes | Verified independently: `en` and `pt-BR` `translation.json` have exactly the same 32 leaf keys under `history` (Python set diff, zero keys in either side only) |

## Edge Cases (spec.md, below User Stories)

| # | Edge case | Covered | Evidence / gap |
|---|-----------|---------|------------------|
| 1 | Two people restore different snapshots near-simultaneously → trust the server response, never overwrite with a stale optimistic state | **No** | See Gap #2 below — no test exercises out-of-order/concurrent responses. |
| 2 | Restore from another tab changes the scene while a create-name draft is unsaved → preserve the draft text | Yes | `HistoryPanel.spec.tsx:467-498` — restores while a draft name is typed, asserts the input still holds `'draft name not yet submitted'` after the relist. (Tests the same-user restore→relist code path; there is no live cross-tab subscription in this component, so this is the only reachable trigger of that code path today — see Gap #3.) |
| 3 | No revision besides the initial one → compare disabled with explanation | Yes | `DiffView.spec.tsx:123-134` |
| 4 | Restore fails with a non-404 error (e.g. 403) → show failure, never apply anything to the canvas | Yes | `HistoryPanel.spec.tsx:407-431` — asserts failure message shown and `onRestored` never called |

## SNAP-08 deviation assessment

`HistoryPanel` takes an `onRestored: () => Promise<void>` callback instead of an
`EditorSurfaceHandle` directly (documented as `SPEC_DEVIATION` in `HistoryPanel.tsx:11-16`). This
callback is the exact same `handleApproved` `DiagramEditorPage` already wires to `AiDock`'s
`onApproved`. Assessed as sound, independent of the comment's own claim:

- `RestoreResponseBody` (`snapshotClient.ts:52-55`) only carries `currentRevision` and
  `restoredFromSnapshotId` — the restore endpoint does **not** return the restored scene itself.
  Reusing the bootstrap-then-`applyRemoteScene` flow is therefore not just a convenience, it's
  necessary to actually obtain the scene.
- `DiagramEditorPage.spec.tsx:515-578` proves the wiring works end-to-end: the second bootstrap
  call (the one triggered post-restore) is the one whose scene reaches `applyRemoteScene`
  (`EditorSurface`'s `updateScene` spy), and it contains the restored element.
- This still satisfies SNAP-08's actual intent ("the canvas reflects the restored scene via
  `applyRemoteScene`") even though `HistoryPanel` never touches the handle directly.

## Discrimination sensor (mutation testing)

All mutations applied directly in the worktree, one at a time, then reverted with
`git checkout -- <file>` before the next; `git status --porcelain` confirmed empty after each
revert and at the end.

| # | File | Mutation | Result |
|---|------|----------|--------|
| 1 | `snapshotClient.ts` | Swapped which status maps to `not_found` vs `forbidden` in `restore()` | **Killed** — 4 test failures (`snapshotClient.spec.ts` 404/403 branch tests) |
| 2 | `snapshotClient.ts` | `create()` sends `{name: ''}` instead of omitting the field when blank | **Killed** — 3 test failures (SNAP-04 test in both `snapshotClient.spec.ts` and `HistoryPanel.spec.tsx`) |
| 3 | `HistoryPanel.tsx` | Made `confirmRestore` call `onRestored()` even on `not_found` | **Killed** — SNAP-09 test's `expect(onRestored).not.toHaveBeenCalled()` fails |
| 4 | `HistoryPanel.tsx` | Insert a newly-created snapshot at the **end** of the list instead of the top | **Killed** — SNAP-03 test's `rows[0]` no longer contains the new name |
| 5 | `DiffView.tsx` | Inverted `isEmptyDiff` (`.every(...===0)` → `.some(...===0)`) | **SURVIVED** — all 5 `DiffView.spec.tsx` tests still pass |
| 6 | `snapshotLabel.ts` | Returned the raw `kind` string (`'auto'`) instead of the translated label for that one kind | **Killed** — SNAP-01 test expecting `"Automático"` fails |

### Gap #1 (highest priority): surviving mutant in `DiffView.isEmptyDiff`

`isEmptyDiff` (`DiffView.tsx:16-18`) is only exercised by two shapes in
`DiffView.spec.tsx`: all-four-categories-populated (SNAP-11, `:32-68`) and
all-four-categories-empty (SNAP-12, `:70-95`). Both mutant and original agree on those two shapes
(`every` and `some` coincide when all four are equal). No test exercises a **mixed** diff (e.g.
`added: ['x'], removed: [], moved: [], modified: []`) — the case that actually distinguishes
`.every(c => c.length===0)` from `.some(c => c.length===0)`. With the inverted logic, a diff with
one real change and three empty categories would incorrectly render "no structural changes"
instead of the categorized lists. This is a genuine, currently-unguarded regression risk in a
function whose only job is that empty/non-empty distinction (SNAP-12's whole point).

### Gap #2: Edge Case 1 has no direct test

Spec's edge case ("two people restore near-simultaneously → trust the server response, never an
old optimistic state") has no dedicated test. The implementation never applies anything
optimistically (`confirmRestore` always awaits the server response before touching state), which
covers the literal wording. But `refreshList()` (`HistoryPanel.tsx:71-79`) — unlike the initial-load
`useEffect` (`:52-68`, which uses a `cancelled` flag) — has no guard against two overlapping
`list()` calls resolving out of order; a slower, older `refreshList()` response could in principle
overwrite a newer one. No test proves out-of-order resolution can't produce a stale display. Lower
severity than Gap #1 since the current UI can't easily trigger two overlapping restores from a
single panel instance (the confirm dialog is modal), but it's an unverified assumption for the
literal cross-tab race the edge case describes.

### Gap #3 (minor, informational): Edge Case 2's "another tab" framing isn't literally reachable

`HistoryPanel` has no live/websocket subscription to another tab's restore — the only thing that
triggers `refreshList()` is this panel's own restore action. The existing test
(`HistoryPanel.spec.tsx:467-498`) covers the mechanism (draft name survives a relist) via the only
code path that currently exists, which is a reasonable adaptation, but it doesn't literally test
"another tab" causing the preservation. Not a regression risk today since no other trigger exists;
flagged only for completeness.

## Gate results (run directly, this session)

```
pnpm --filter @arch-canvas/web run test:unit    → 31/31 files, 278/278 tests passed
pnpm --filter @arch-canvas/web run typecheck    → clean (tsc --noEmit, no errors)
pnpm -w exec biome check apps/web/src/history/ apps/web/src/diagram/ → clean, no fixes
git status --porcelain (whole worktree)          → empty before, during (per-mutation), and after
```

## Ranked gaps (most important first)

1. **Surviving mutant**: `DiffView.isEmptyDiff` has no test for a mixed diff (some categories
   populated, some empty) — the inverted-logic mutant survives undetected. Recommend adding one
   `DiffView.spec.tsx` case with e.g. `added: ['x']` and the other three empty, asserting the
   categorized lists render (not the "no changes" message).
2. **Edge Case 1** (concurrent restores / stale-response ordering) has no direct test, and
   `refreshList()` lacks the same out-of-order-response guard the initial-load effect has.
3. **Minor**: Edge Case 2's test covers the reachable code path (own-restore-triggers-relist) but
   not literally "another tab" triggering it, since no such live-update mechanism exists in this
   component today. Informational only, not a regression risk under the current design.

No other gaps found — tasks.md's T1-T6 "Done when" checklists are all checked and each item traces
to real, matching test evidence; i18n key parity between `en`/`pt-BR` is exact; the SNAP-08
`SPEC_DEVIATION` is justified by the restore endpoint's actual response shape, not just asserted.
