# realtime-presence Validation

**Date**: 2026-08-17
**Spec**: `.specs/features/realtime-presence/spec.md`
**Diff range**: `f3ed671..a51fa2c` (branch `feature/r10-realtime-presence`)
**Verifier**: independent sub-agent (author ≠ verifier)

**Verdict**: **PASS ✅**

Branch history confirmed clean and linear: 16 commits, all belonging to this wave, no
interleaving from the sibling R9/R11/R15/R16 worktrees (`git log --oneline f3ed671..HEAD`
returns exactly the same set with and without the `-- apps/server apps/web packages docs
.specs/features/realtime-presence` pathspec).

---

## Task Completion

All 15 tasks are `[x]` in `tasks.md`, including every nested "Done when" checkbox.

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 `presencePayloadSchema` identity | ✅ Done | Additive; both directions covered |
| T2 ws-gateway relay identity | ✅ Done | The core wire fix; 3 real-socket integration tests |
| T3 `applyCollaborators` handle | ✅ Done | Additive method on the AD-010 handle |
| T4 presence i18n keys | ✅ Done | `presence.status.*` present and key-identical in both locales |
| T5 `presenceStore` | ✅ Done | 7 unit tests |
| T6 `collaboratorColor` | ✅ Done | Pure FNV-1a → fixed 8-pair palette |
| T7 `PresenceClient` connect/receive | ✅ Done | 10 unit tests |
| T8 local broadcast (throttle/idle/prune) | ✅ Done | 6 unit tests |
| T9 reconnect backoff | ✅ Done | 5 unit tests |
| T10 `ConnectionStatus` | ✅ Done | 4 unit tests |
| T11 a11y suite | ✅ Done | 4 axe/tab-order/locale tests |
| T12 page wiring | ✅ Done | Deviation recorded in-task (see Deviation Review) |
| T13 reconnect catch-up | ✅ Done | 4 page-level tests; closes the dead `catchUp()` loop |
| T14 Vite `/ws` proxy | ✅ Done | `ws: true`, existing prefixes unchanged |
| T15 capability map | ✅ Done | Residual disclosed in-task |

---

## Spec-Anchored Acceptance Criteria

### P1: A retransmissão de presença carrega a identidade de quem enviou (LIVE-01..05)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| LIVE-01 relay includes `senderId` = ticket-authenticated user | `senderId` equals A's user id | `apps/server/src/modules/ws-gateway/presenceIdentity.int.spec.ts:198` — `expect(receivedOnB[0]?.payload).toEqual({cursor:{x:12,y:34}, selection:['el-a'], status:'active', senderId: owner.user.id, displayName:'Ana Owner'})` | ✅ PASS |
| LIVE-02 relay includes `displayName` = `users.display_name`, resolved once per connection | `displayName` equals A's seeded name | same assertion, `presenceIdentity.int.spec.ts:198`; resolution-once verified in `apps/server/src/modules/ws-gateway/routes.ts:74-80` (`resolveDisplayName`) called once at `routes.ts:207` outside the message handler | ✅ PASS |
| LIVE-03 never echoes a sender's own presence back | A receives nothing | `presenceIdentity.int.spec.ts:224` — `expect(receivedOnA).toEqual([])`, with `:225` `expect(receivedOnB[0]?.payload.senderId).toBe(owner.user.id)` as the happens-after marker | ✅ PASS |
| LIVE-04 client-supplied `senderId`/`displayName` ignored, ticket actor used | Relayed id is the REAL actor, not the forged one | `presenceIdentity.int.spec.ts:250-252` — `expect(...senderId).toBe(owner.user.id)`; `expect(...senderId).not.toBe(forgedId)`; `expect(...displayName).toBe('Ana Real')` | ✅ PASS |
| LIVE-05 schema accepts a payload with neither field | Parses, both fields `undefined` | `packages/shared-contracts/src/ws-messages.spec.ts:59-61` — `expect(parsed.payload).toEqual({status:'active'})`; both `.toBeUndefined()`. Round-trip preserved at `:76-77`; non-uuid rejected with `code 'invalid_payload'`, `field 'payload.senderId'` at `:88-89` | ✅ PASS |

### P1: O editor abre uma sessão de presença ao vivo (LIVE-06..08)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| LIVE-06 ticket POST then socket open with `ticket` query param | URL `/ws/diagrams/<id>?ticket=<value>` | `apps/web/src/presence/presenceClient.spec.ts:112-118` — `expect(fetchImpl).toHaveBeenCalledWith('/diagrams/<id>/ws-ticket',{method:'POST'})` and `expect(FakeSocket.last?.url).toBe('ws://localhost:3000/ws/diagrams/<id>?ticket=the-ticket')`. Page-level: `apps/web/src/diagram/DiagramEditorPage.spec.tsx:928` | ✅ PASS |
| LIVE-07 ticket non-2xx or network failure → no socket, `disconnected` | Zero sockets; phase `disconnected` | `presenceClient.spec.ts:133-134` (403) and `:146-147` (throw) — `expect(FakeSocket.instances).toHaveLength(0)`; `expect(store.getState().connection).toBe('disconnected')` | ✅ PASS |
| LIVE-08 unmount closes socket, cancels timers, no reconnect | Socket closed, later `connect()` ignored | `presenceClient.spec.ts:158-163` — `readyState` 3, phase `disconnected`, `expect(FakeSocket.instances).toHaveLength(1)` after a second `connect()`. Timers: `:372` `expect(timers.scheduled.filter(t=>!t.cancelled)).toEqual([])`. Page unmount: `DiagramEditorPage.spec.tsx:1046` — `expect(socket?.readyState).toBe(3)` | ✅ PASS |

### P1: O editor transmite a própria presença (LIVE-09..12)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| LIVE-09 ≤1 `presence` per 50 ms carrying the LAST position | Exactly 1 message, coords of the 10th move | `presenceClient.spec.ts:300,304` — `expect(socket?.sent).toHaveLength(0)` before the timer, then `expect(sentPayloads(socket)).toEqual([{cursor:{x:9,y:18}, status:'active'}])` after `timers.fire(50)`. Both clauses asserted (L-027). Page-level: `DiagramEditorPage.spec.tsx:1006-1008` — last position on the wire AND `toHaveLength(1)` | ✅ PASS |
| LIVE-10 selection change sends `selection` = selected ids | Immediate, ids as given | `presenceClient.spec.ts:312` — `expect(sentPayloads(socket)).toEqual([{selection:['el-1','el-2'], status:'active'}])`. Page-level reuse of existing `onSelectionChange`: `DiagramEditorPage.spec.tsx:1030` | ✅ PASS |
| LIVE-11 nothing sent while socket not open | Zero sends | `presenceClient.spec.ts:329` — `expect(FakeSocket.last?.sent).toEqual([])` after both `sendSelection` and a fired cursor throttle | ✅ PASS |
| LIVE-12 60 s idle → exactly one `status:'idle'`, back to `active` on movement | One idle message, not repeated; next move `active` | `presenceClient.spec.ts:338` `toEqual([{status:'idle'}])`; `:343` unchanged after a second sweep; `:347` `toEqual([{status:'idle'},{cursor:{x:3,y:4},status:'active'}])` | ✅ PASS |

### P1: O editor renderiza a presença remota (LIVE-13..18)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| LIVE-13 register sender with `pointer` at received position and `username` = `displayName` | Exact collaborator entry | `packages/editor-adapter/src/EditorSurface.spec.tsx:213-221` — `expect([...sceneData.collaborators.keys()]).toEqual(['user-a','user-b'])` and full `toEqual` on the entry (`pointer`, `username`, `color`, `selectedElementIds`). End-to-end: `DiagramEditorPage.spec.tsx:977` — `expect(sceneData.collaborators.get(PEER_ID)).toEqual({id, username:'Ana', color: collaboratorColor(PEER_ID), pointer:{x:30,y:40,tool:'pointer'}, selectedElementIds:{'el-9':true}})` | ✅ PASS |
| LIVE-14 `selectedElementIds` exactly the received ids | `{'el-9': true}` | same assertions, `EditorSurface.spec.tsx:214` and `DiagramEditorPage.spec.tsx:977`. Store side: `presenceClient.spec.ts:182` `toEqual({senderId, displayName:'Ana', cursor:{x:11,y:22}, selection:['el-1','el-2'], lastSeenAt:4242})` | ✅ PASS |
| LIVE-15 colour stable per `senderId` across sessions/clients | Same id → same pair, always | `apps/web/src/presence/collaboratorColor.spec.ts:8` — 5 repeated calls `toEqual(first)`; `:15` spread `>1`; `:21-23` well-formed distinct hex. Cross-session stability holds structurally: `collaboratorColor.ts:38-42` is pure (FNV-1a → fixed const palette), no I/O, no seed | ✅ PASS |
| LIVE-16 `presence` without `senderId` ignored, map untouched | Map stays `{}` | `presenceClient.spec.ts:199` — `expect(store.getState().remotes).toEqual({})` | ✅ PASS |
| LIVE-17 never include the logged-in user in the map | Map stays `{}` for self-id | `presenceClient.spec.ts:217` — `expect(store.getState().remotes).toEqual({})` | ✅ PASS |
| LIVE-18 `status:'idle'` removes the sender | Present, then removed | `presenceClient.spec.ts:229` `toBeDefined()` then `:232` `toEqual({})` | ✅ PASS |

### P1: Reconexão com catch-up (LIVE-19..23)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| LIVE-19 unexpected close → capped exponential backoff, NEW ticket per attempt | Growing capped delay; fresh ticket each try | `presenceClient.spec.ts:400,406-411` — `reconnectDelayMs(0)` = 1000, a scheduled timer at `reconnectDelayMs(1)` = 2000, cap `reconnectDelayMs(99)` = 30_000; `:422-423` — `expect(fetchImpl).toHaveBeenCalledTimes(2)` and 2 socket instances. Policy codes stop retry: `:447-448`. Explicit `close()` stops retry: `:458-459` | ✅ PASS |
| LIVE-20 successful reconnect calls `catchUp()` | `GET /diagrams/:id/operations?afterSequence=` issued | `presenceClient.spec.ts:430,437` — `onReconnected` not called on first open, `toHaveBeenCalledTimes(1)` after reconnect. Real wiring: `DiagramEditorPage.spec.tsx:1141` — `expect(impl).toHaveBeenCalledWith('/diagrams/diagram-1/operations?afterSequence=1')` after a simulated drop + reopen | ✅ PASS |
| LIVE-21 `appliedCount > 0` → `bootstrap()` + `applyRemoteScene`, never a remount | Scene refetched and applied through the handle | `DiagramEditorPage.spec.tsx:1154,1161` — `expect(bootstrapCallCount()).toBe(2)` and `expect(elements.some(e => e.id === 'el-from-catch-up')).toBe(true)` on an `updateScene` call carrying `elements`. Remount excluded structurally: the page never keys `<EditorSurface/>`; the only path is `editorSurfaceRef.current?.applyRemoteScene` (`DiagramEditorPage.tsx:198`) | ✅ PASS |
| LIVE-22 `appliedCount === 0` → no scene fetch, canvas untouched | 1 bootstrap total, zero element updates | `DiagramEditorPage.spec.tsx:1175-1176` — `expect(bootstrapCallCount()).toBe(1)` and the filtered `updateScene` calls carrying `elements` `toEqual([])` | ✅ PASS |
| LIVE-23 while disconnected the collaborator map is empty | `remotes` cleared on drop | `presenceClient.spec.ts:243-248` — present before, then `connection 'disconnected'` and `remotes toEqual({})`. Canvas side: `EditorSurface.spec.tsx:235-236` — empty map forwarded, `expect(sceneData.elements).toBeUndefined()` | ✅ PASS |

### P2: Estado da conexão (LIVE-24..27)

| Criterion | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| LIVE-24 distinct text for `connecting`/`connected`/`disconnected` | Three distinct strings | `apps/web/src/presence/ConnectionStatus.spec.tsx:15,22,29` — one `textContent` assertion per phase. Store mapping: `presenceStore.spec.ts:35` maps each phase to `presence.status.<phase>`. Page-level transition: `DiagramEditorPage.spec.tsx:937,946` — "Conectando à presença ao vivo…" → "Presença ao vivo conectada" | ✅ PASS |
| LIVE-25 announce new state in an `aria-live="polite"` region | Attribute present, text updates in place | `ConnectionStatus.a11y.spec.tsx:61-69` — `expect(region.getAttribute('aria-live')).toBe('polite')` asserted as an attribute (L-030) before AND after the phase change, with both `textContent` values asserted | ✅ PASS |
| LIVE-26 not in tab order; no serious/critical a11y violations | Zero focusables, zero serious/critical | `ConnectionStatus.a11y.spec.tsx:37` — `expect(seriousOrCriticalViolations(results)).toEqual([])` across all three phases; `:48,51,53` — zero focusable nodes, no `tabindex`, `document.activeElement` not the region after `.focus()` | ✅ PASS |
| LIVE-27 renders in both `pt-BR` and `en` | English string in `en` locale | `ConnectionStatus.a11y.spec.tsx:76` — `textContent` `toBe('Live presence disconnected')`; pt-BR asserted throughout `ConnectionStatus.spec.tsx`. Keys verified key-identical in both `translation.json` files | ✅ PASS |

**Status**: ✅ All 27 ACs covered with `file:line` evidence; every asserted value matches the
spec-defined outcome. Zero spec-precision gaps.

---

## Focused Review of Flagged Areas

1. **`senderId`/`displayName` wire fix (the feature's core).** Verified against REAL `ws`
   sockets — `presenceIdentity.int.spec.ts:10` imports `ws`, `:122` constructs real
   `WebSocket`s against a Fastify bound on port 0 (`:51`). No mocked socket anywhere on the
   server side; the codebase's established discipline is followed. All three sub-cases hold,
   including the impersonation case: a client-chosen `senderId` (`randomUUID()`, `:230`) is
   rejected and the assertion targets the server-derived id (`:250-252`), asserting both
   `toBe(owner.user.id)` and `not.toBe(forgedId)`. The guarantee is structural, not incidental:
   `routes.ts:378-382` builds the published event from `actorId`/`actorDisplayName` and never
   reads `message.payload.senderId`.
2. **Shared schema additive + single source.** `ws-messages.ts:74-80` adds two `.optional()`
   fields; the three pre-existing `presence` fields are byte-identical. `apps/server` consumes
   it via `parseWsMessage`; `apps/web` consumes the SAME import (`presenceClient.ts:1`,
   destructuring `senderId`/`displayName` off `message.payload` at `:336`). No local
   re-declaration of the payload shape exists in either app — no drift surface.
3. **Throttle is behaviourally proven.** `presenceClient.spec.ts:296-304` fires 10 `sendCursor`
   calls, asserts ZERO sends before the timer, then exactly one payload with the 10th
   coordinates — a call-count assertion driven by the injectable `timerHarness`, not wall-clock
   sleeping. Design matches: trailing `setTimeout` window (`presenceClient.ts:156-162`), no
   `requestAnimationFrame` anywhere in the diff.
4. **Reconnect/catch-up loop genuinely closed.** `catchUp()` gained its first real caller
   (`DiagramEditorPage.tsx:170-175`). The page test does a full simulated
   drop → backoff → new ticket → new socket → open (`DiagramEditorPage.spec.tsx:1115-1124`) and
   then asserts the SCENE changed — a new element id appears in `updateScene` (`:1161`) — not
   merely that `catchUp()` was invoked. The `appliedCount === 0` and failure branches are
   asserted separately.
5. **Native Excalidraw collaborator rendering.** `EditorSurface.tsx:152-154` forwards the map
   straight into `updateScene({collaborators})`. No manual cursor DOM/canvas overlay exists in
   the diff. `elements` was made optional so a collaborator push never touches scene content
   (asserted at `EditorSurface.spec.tsx:236`).
6. **The `onPointerMove` deviation is documented, necessary and additive.** Recorded in
   `tasks.md:399` as an explicit **"Deviation (recorded during Execute)"** block in T12 — not a
   silent expansion. Necessity confirmed: scene coordinates require the live scroll/zoom
   transform, which only Excalidraw holds; the prop is backed by the public `onPointerUpdate`
   (`EditorSurface.tsx:234-240`), so no caller duplicates a viewport conversion. Additive:
   `onPointerMove?` is optional (`EditorSurface.tsx:35`), every existing prop and the two
   existing handle methods are unchanged, and the 5 pre-existing `EditorSurface` tests still
   pass untouched.
7. **No live scene-content broadcasting was built.** `grep -rn "mutation_broadcast|sync_state|sync_request" apps/web/src`
   returns nothing — the web client's `handleMessage` returns early for any type other than
   `presence` (`presenceClient.ts:334`). The server's deliberate filter is untouched: the diff
   contains no line touching `mutation_broadcast`, and `handlePresenceEvent`'s
   `if (event.type !== 'presence_update') return;` guard is unchanged. Scene *content* still
   reaches the canvas only via REST bootstrap/catch-up.
8. **Audit residual honestly disclosed.** `tasks.md:498` records that
   `GET /ws/diagrams/:diagramId` stays `pending-product` because the static scanner cannot
   resolve `new SocketImpl(url)`, naming it as the same limitation class already logged for
   `sso-sign-in`/`workspace-navigation`. Verified: the route is still listed as pending
   (`docs/route-inventory.md:108`), while `POST /diagrams/:id/ws-ticket` correctly moved to
   `consumed` (`route-inventory.md:18`). `repo-tools audit` exits 0.

---

## Discrimination Sensor

**Scratch**: `git worktree add /tmp/r10-sensor HEAD` (outside this worktree's tree), deps
installed, workspace built, control run green (3/3) before any mutation. Never `git stash`.

| # | File:line | Mutation | Killed? |
| --- | --- | --- | --- |
| 1 | `apps/server/.../ws-gateway/routes.ts:203-204` | Reverted the relay to strip `senderId`/`displayName` before `send()` (the pre-R10 bug) | ✅ Killed — 3/3 `presenceIdentity` tests fail |
| 2 | `apps/server/.../ws-gateway/routes.ts:379-380` | Server trusts a client-forged identity: `senderId: message.payload.senderId ?? actorId` | ✅ Killed — LIVE-04 test fails; LIVE-01/02/03 correctly still pass (precise targeting) |
| 3 | `apps/server/.../ws-gateway/routes.ts:192` | Removed the self-echo filter `if (event.senderId === actorId) return;` | ✅ Killed — LIVE-03 test fails, other two pass |
| 4 | `apps/web/src/presence/presenceClient.ts:156` | Broke the throttle: publish on every `sendCursor`, unthrottled | ✅ Killed — LIVE-09 and LIVE-12 tests fail |
| 5 | `apps/web/src/diagram/DiagramEditorPage.tsx:171` | Broke reconnect→catch-up: `handleReconnected` no longer calls `catchUp()` | ✅ Killed — all 4 LIVE-20..22 page tests fail |
| 6 | `packages/editor-adapter/src/EditorSurface.tsx:153` | Broke the collaborators passthrough: forwards `new Map()` instead of the real map | ✅ Killed — LIVE-13/14 test fails |
| 7 | `packages/editor-adapter/src/EditorSurface.tsx:238` | Pointer never forwarded from `onPointerUpdate` to `onPointerMove` | ✅ Killed — LIVE-09 adapter test fails |

**Sensor depth**: P0-full (7 mutations, ≥5 required for the WS protocol/identity surface)
**Result**: 7/7 killed — **PASS ✅**

**Isolation**: pre-sensor `git status --porcelain` was empty at `a51fa2c`; after
`git worktree remove --force /tmp/r10-sensor` + `git worktree prune`, porcelain is empty and
HEAD is still `a51fa2c`. Scratch path confirmed deleted. Baseline matched exactly.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code | ✅ Two surgical server edits; the client is 4 small modules |
| Surgical changes | ✅ 27 files, no drive-by refactors; pre-existing `wsGateway.int.spec.ts` untouched and still 11/11 green |
| No scope creep | ✅ Every Out-of-Scope row respected — no roster, no follow mode, no laser tool, no avatars, no `comment_event`/`permission_changed`/`server_draining` handling, no presence persistence |
| Matches patterns | ✅ `fetchImpl`/timer injection mirrors `DiagramSyncClient`; store mirrors `createSaveStatusStore`; a11y suite mirrors `WorkspaceMembersPage.a11y.spec.tsx`; integration suite mirrors `wsGateway.int.spec.ts` |
| No abstractions for single-use code | ✅ `collaboratorColor` is a 10-line pure function; `FakeSocket` lives in `src/` only because two spec files share it (justified in its own docstring) |
| Would a senior engineer approve? | ✅ Comments explain *why* (identity resolved once, why fields are optional, why imperative over reactive), not *what* |
| Spec-anchored outcome check | ✅ 27/27 assertions target spec-defined values; two-clause ACs assert both clauses (L-027 applied) |
| Per-layer Coverage Expectation met | ✅ Every row of the Test Coverage Matrix has its file; server relay covered happy + no-echo + forged-identity paths |
| Every test maps to a spec requirement | ✅ All 58 new tests carry a LIVE-NN or task tag in their title; no unclaimed tests |
| Documented guidelines followed | ✅ `CLAUDE.md` (Node 22, gate list), AD-002/008/009/010/011 honoured; `apps/web` coverage floors held (presence dir 98.76% lines) |
| AD-008 respected | ✅ No value import of `@excalidraw/excalidraw` server-side; `RemoteCollaborator` declared structurally to avoid the internal subpath |

---

## Edge Cases

- [x] **Peer already connected before I join** — shows on their first `presence` message. Disclosed
      limitation (no roster message exists); behaviour follows structurally from `upsertRemote`
      being the only insertion path (`presenceClient.ts:351`).
- [x] **Remote silent for 90 s is pruned** — `presenceClient.spec.ts:363` `expect(store.getState().remotes).toEqual({})`
      after advancing the clock past `STALE_REMOTE_AFTER_MS` and firing the sweep.
- [x] **Same person in two tabs ignores its own presence** — `presenceClient.spec.ts:217`
      (`senderId === selfUserId` filtered, `remotes` stays `{}`).
- [x] **Policy close code `4403`/`4413` stops reconnecting** — `presenceClient.spec.ts:447-448`,
      looped over both codes: phase `disconnected` and zero uncancelled timers.
- [x] **Malformed / unhandled WS frame dropped silently** — `presenceClient.spec.ts:271-272`:
      after invalid JSON, an unknown type, and a valid `pong`, connection is still `connected`
      and `remotes` is `{}`.
- [ ] **`bootstrap()` failure during catch-up leaves the canvas as-is and stays connected** —
      ⚠️ **NOT covered.** The nearest test (`DiagramEditorPage.spec.tsx:1183`) fails the
      *operations* route (`catchUp()`), not `bootstrap()`. The `catch {}` guarding the
      `bootstrap()` call (`DiagramEditorPage.tsx:199-202`) is never entered — line 202 appears
      in the uncovered-line list for this file in the coverage report. The behaviour is
      implemented and typechecked; only the proof is missing. See Fix Plans.

---

## Gate Check

- **Gate command**: `make lint && make typecheck && make test-unit` (the documented sandbox
  substitute for `make ci`, per `CLAUDE.md`), run under Node 22.23.2 via `fnm use 22`.
- **Result**: **exit 0** — 24/24 Turbo tasks successful. `@arch-canvas/web`: 53 test files,
  460/460 tests passed. Zero failures, zero unjustified skips.
- **Integration**: `pnpm -w build` OK, then `pnpm --filter @arch-canvas/server run test:integration`
  → 49/52 files passed, **353 tests passed, 0 test-level failures**, 13 skipped (pre-existing).
  - `presenceIdentity.int.spec.ts` — **3/3 passed** (re-run in isolation to confirm).
  - `wsGateway.int.spec.ts` — **11/11 passed**, no regression from the relay change.
  - 3 failing FILES, all pre-existing sandbox gaps untouched by this diff:
    `ws-gateway/crossInstancePresence.int.spec.ts` and `ws-gateway/presenceBroadcaster.int.spec.ts`
    (both `Error: spawn redis-server ENOENT` — the documented missing-daemon gap), and
    `backup/restoreTest.int.spec.ts` (the diff touches no file under `apps/server/src/modules/backup`).
- **Audit**: `pnpm --filter @arch-canvas/repo-tools run audit` → exit 0, 90 routes, 20 consumed
  (up from 19), 70 pending-product.
- **Test count delta**: **+58 tests** (3 server integration, 3 shared-contracts, 3 editor-adapter,
  21 `presenceClient`, 7 `presenceStore`, 3 `collaboratorColor`, 4 `ConnectionStatus`,
  4 a11y, 10 `DiagramEditorPage`). No test deleted, no assertion weakened.

---

## Deviation Review

| Deviation | Where recorded | Assessment |
| --- | --- | --- |
| T12 also touches `packages/editor-adapter/src/EditorSurface.tsx` to add an `onPointerMove` prop | `tasks.md:399`, an explicit "Deviation (recorded during Execute)" block | **Accepted.** Genuinely necessary (scene coordinates need the scroll/zoom transform that only Excalidraw holds), minimal (optional prop over the public `onPointerUpdate`), additive (no existing prop or handle signature changed), and tested (`EditorSurface.spec.tsx:239`). `design.md:228` said "sem mudança de props" for `DiagramEditorPage` — that page's props are indeed unchanged; the adapter prop is the recorded refinement. |
| `presenceIdentity.int.spec.ts:1` carries a `// SPEC_DEVIATION` marker for PGlite over testcontainers | File header | **Pre-existing project-wide convention** (AD-007), identical to every other `*.int.spec.ts` in this repo. Not a deviation introduced by this wave. |

---

## Fix Plans

### Fix 1: Edge case "`bootstrap()` failure during catch-up" has no test

- **Root cause**: `DiagramEditorPage.spec.tsx`'s `catchUpFetchImpl` helper can fail the
  `operations` route (`catchUpFails`) but has no switch to fail the second `bootstrap` call, so
  the `catch {}` at `DiagramEditorPage.tsx:199-202` is never exercised. T13's Done-when bundles
  two clauses ("uma falha de `catchUp()` **ou de `bootstrap()`**") and only the first is proven.
- **Fix task**: extend `catchUpFetchImpl` with a `bootstrapFailsAfterFirstCall` flag; add a test
  where `operations` reports `appliedCount > 0` but the second `GET /diagrams/:id/bootstrap`
  returns 500, asserting (a) no `updateScene` call carrying `elements`, (b) the connection
  status still reads "Presença ao vivo conectada", (c) no error surfaces in the React tree.
- **Priority**: **Minor** — the defensive branch is implemented, typechecked and lint-clean; only
  its proof is absent. It maps to a listed Edge Case, not to any LIVE-NN requirement, so it does
  not block the wave.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| LIVE-01 .. LIVE-27 (all 27) | Implementing | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 27/27 ACs matched the spec-defined outcome; 0 spec-precision gaps
**Sensor**: 7/7 mutations killed (P0-full)
**Gate**: exit 0 — 24/24 Turbo tasks; 460/460 web unit tests; 353 server integration tests passed

**What works**:
- The wire-protocol fix is real and correctly scoped: relayed `presence` carries the
  ticket-authenticated `senderId` plus a `displayName` resolved once per connection, self-echo is
  still suppressed, and a client-forged identity is discarded in favour of the real actor — all
  three proven with two real `ws` sockets and all three killed by targeted mutations.
- The schema change is additive and single-sourced; both apps consume the same shared type.
- The 50 ms trailing throttle collapses bursts, proven by call-count with an injected timer.
- The previously-dead `catchUp()` loop is closed end-to-end and proven by an actual
  disconnect→reconnect that changes the scene through `applyRemoteScene`, never a remount.
- Remote cursors ride Excalidraw's own `collaborators` map — no hand-rolled overlay.
- Live scene-content co-editing was NOT built: AD-002 and the server's `mutation_broadcast`
  filter are both intact.

**Issues found**: one Minor edge-case coverage gap — the `bootstrap()`-failure branch of the
catch-up path is implemented but untested (Fix 1 above). No other gaps.

**Next steps**: merge. Optionally schedule Fix 1 as a small follow-up test task; it is not a
blocker for this wave.
