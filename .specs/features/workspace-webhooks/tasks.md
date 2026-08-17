# Webhooks do workspace — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: inline (Medium scope — no separate design.md; the spec's Assumptions table already resolved the three real design questions: a dedicated `webhookClient.ts` instead of the `resourceClient` generic, a persistent one-time secret panel instead of a toast, and an in-row two-step confirmation for rotation instead of touching the shared `ConfirmArchiveDialog`).
**Status**: Approved

**Server scope**: none. All 5 routes already exist, are implemented and integration-tested (`apps/server/src/modules/webhook/routes.ts`, `webhook.int.spec.ts`). No task below touches `apps/server/**`.

---

## Test Coverage Matrix

> Generated from codebase sampling (`apps/web/src/nav/memberClient.spec.ts`, `apps/web/src/nav/WorkspaceMembersPage.spec.tsx`, `apps/web/src/nav/WorkspaceMembersPage.a11y.spec.tsx`, `apps/web/src/nav/ConfirmArchiveDialog.spec.tsx`, `apps/web/src/App.spec.tsx`) and this repo's coverage-floor convention (never lowered). Guidelines found: none beyond `CLAUDE.md`'s "Comandos" and `.claude/commands/gate.md` — strong default applied.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------- | --------------------- | ----------------- | ------------ |
| Client (`webhookClient`) | unit | Every documented status branch of all 5 routes: list 200/non-2xx, create 201/non-201, update 200/non-200, remove 204/non-204, rotate 200/non-200, plus network rejection | `apps/web/src/nav/webhookClient.spec.ts` | `pnpm --filter @arch-canvas/web run test:unit` |
| i18n JSON (`translation.json` × 2) | none | Build/lint gate only | `apps/web/src/i18n/locales/{en,pt-BR}/translation.json` | build gate only |
| Component (`WebhookSecretPanel`) | unit (RTL) | 1:1 to spec ACs WHK-11..17: secret rendered as text, one-time warning, copy success, clipboard-absent and clipboard-rejected degrade, persistence across re-render, dismissal removing the secret | `apps/web/src/nav/WebhookSecretPanel.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Component (`WorkspaceWebhooksPage`) | unit (RTL) | 1:1 to spec ACs WHK-01..10 and WHK-18..30 (list, empty state, no-access, create incl. both client-side blocks, edit incl. no-change and failure, enabled toggle, rotate incl. cancel and failure, remove incl. failure) + the 4 listed edge cases | `apps/web/src/nav/WorkspaceWebhooksPage.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Accessibility (`WorkspaceWebhooksPage`) | unit (axe) | Zero serious/critical violations across the page's states; explicit keyboard-focus assertions and an explicit `en`-locale render; WHK-31..33 | `apps/web/src/nav/WorkspaceWebhooksPage.a11y.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Integration (routing + `ProjectListPage` link) | unit (RTL) | `/w/:workspaceId/webhooks` renders the page inside `AppShell`; the link appears for an admin role and is absent for a non-admin role | `apps/web/src/App.spec.tsx`, `apps/web/src/nav/ProjectListPage.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After a task with unit tests only, scoped to one package | `pnpm --filter @arch-canvas/web run test:unit` |
| Full | After a task that touches shared wiring, or closing the feature | `make lint && make typecheck && make test-unit` |
| Build | Closing the feature | `make lint && make typecheck && make test-unit` (`make test-integration` is unnecessary: no task touches server code) |

---

## Execution Plan

6 tasks total — fits a single batch (≤ ~8), executed inline by one worker, no sub-agent-batch split needed.

```
T2 → T3
T1 → T4
T3 → T4
T4 → T5
T4 → T6
```

---

## Task Breakdown

### T1: Create `webhookClient`

**What**: Dedicated client (not the `resourceClient` generic) covering all 5 webhook routes — `list`, `create`, `update`, `remove`, `rotateSecret`.
**Where**: `apps/web/src/nav/webhookClient.ts`
**Depends on**: None
**Reuses**: `apps/web/src/nav/memberClient.ts`'s exact structure — injectable `fetchImpl`, one result-status union per method, **literal `fetchImpl(...)` call sites** (never a local alias like `doFetch`, which the `repo-tools` route-inventory extractor cannot see)
**Requirement**: WHK-01, WHK-08..10, WHK-18..22, WHK-24..27, WHK-29..30

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `WebhookEndpoint` type mirrors the server's `toPublicWebhookEndpoint` projection exactly (`id`, `workspaceId`, `url`, `events`, `enabled`, `createdBy`, `createdAt`, `updatedAt`) — no invented fields, no `secret` field
- [x] `WEBHOOK_EVENT_TYPES` mirrors the server's 5 values in the same order
- [x] `list(workspaceId)` → `WebhookEndpoint[]` from `GET /workspaces/:id/webhooks`'s `{items}`; throws on non-2xx
- [x] `create(workspaceId, {url, events})` → `{status: 'created', webhook, secret}` on 201 | `{status: 'error'}` otherwise
- [x] `update(workspaceId, webhookId, patch)` → `{status: 'ok', webhook}` on 200 | `{status: 'error'}` otherwise
- [x] `remove(workspaceId, webhookId)` → `{status: 'removed'}` on 204 | `{status: 'error'}` otherwise
- [x] `rotateSecret(workspaceId, webhookId)` → `{status: 'rotated', webhook, secret}` on 200 | `{status: 'error'}` otherwise, calling `PATCH /workspaces/:id/webhooks/:webhookId:rotate-secret`
- [x] Every call site reads `fetchImpl(...)` literally
- [x] Unit tests cover every branch above plus a rejected `fetchImpl` per mutating method
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add dedicated webhookClient`

---

### T2: Add `nav.webhooks` i18n keys (pt-BR, en)

**What**: Extend the existing `"nav"` block with a `webhooks` subtree — link/title, empty state, create form labels, the 5 event-type labels, validation messages, secret-panel copy, rotation confirmation copy, outcome messages.
**Where**: `apps/web/src/i18n/locales/en/translation.json`, `apps/web/src/i18n/locales/pt-BR/translation.json`
**Depends on**: None
**Reuses**: existing `nav.*` nesting convention from `workspace-navigation`/`workspace-members`; the shared `nav.archiveConfirm.*`, `nav.back`, `nav.notFound` and `nav.error.*` keys are reused as-is, not duplicated
**Requirement**: WHK-33

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Both locale files (`en` and `pt-BR`) have an identical key set under `nav.webhooks`
- [ ] Includes at minimum: `link`, `title`, `empty`, `urlLabel`, `eventsLabel`, `eventOptions.*` (5 keys, one per `WEBHOOK_EVENT_TYPES` value), `create`, `created`, `urlRequired`, `eventsRequired`, `enabled`, `disabled`, `toggleEnable`, `toggleDisable`, `edit`, `save`, `cancel`, `updated`, `remove`, `removed`, `rotate`, `rotateConfirm`, `rotateWarning`, `rotated`, `secret.title`, `secret.warning`, `secret.copy`, `secret.copied`, `secret.copyFailed`, `secret.dismiss`
- [ ] No key added here duplicates an existing shared `nav.*` key
- [ ] Gate check passes: `make lint`

**Tests**: none (build gate only — matrix says "none" for the i18n JSON layer)
**Gate**: build

**Commit**: `feat(web): add nav.webhooks i18n keys for pt-BR and en`

---

### T3: Create `WebhookSecretPanel`

**What**: The one-time secret reveal surface — read-only secret text, explicit "only time you'll see this" warning, copy button with clipboard-absent/rejected degrade, explicit dismiss.
**Where**: `apps/web/src/nav/WebhookSecretPanel.tsx`
**Depends on**: T2
**Reuses**: `useTranslation()` convention from every other `nav/` component; no shared component fits (this is the first secret-reveal surface in the product — spec.md's Tech Decision)
**Requirement**: WHK-11..17

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Renders the secret as selectable read-only text, always present in the DOM independent of the copy button (WHK-11, WHK-13)
- [ ] Renders the explicit one-time warning from `nav.webhooks.secret.warning` (WHK-12)
- [ ] Copy button calls `navigator.clipboard.writeText(secret)` and reports success (WHK-14)
- [ ] When `navigator.clipboard` is absent OR `writeText` rejects, reports the manual-copy message and keeps the secret rendered (WHK-15)
- [ ] Has no timer, no auto-close, and survives an unrelated re-render with the same props (WHK-16)
- [ ] Dismiss button invokes `onDismiss`; the component owns no dismissal state of its own, so the parent controls unmounting (WHK-17)
- [ ] Unit tests cover each bullet above, including a re-render assertion that fails if an auto-close is ever introduced
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add WebhookSecretPanel one-time secret reveal`

---

### T4: Create `WorkspaceWebhooksPage`

**What**: The webhooks screen — list with empty and no-access states, create form (URL + 5 event checkboxes), per-row inline edit, per-row enabled toggle, per-row two-step rotate confirmation, per-row remove via `ConfirmArchiveDialog`, wired to `WebhookSecretPanel` for both reveal paths.
**Where**: `apps/web/src/nav/WorkspaceWebhooksPage.tsx`
**Depends on**: T1, T3
**Reuses**: `webhookClient` (T1), `WebhookSecretPanel` (T3), `ConfirmArchiveDialog` unchanged, `resourceListStore` unchanged (the server projection already has `id: string`, no shim needed), `WorkspaceMembersPage.tsx`'s overall structure (back link, `aria-live` region, notFound branch, `useMemo`'d client/store)
**Requirement**: WHK-01, WHK-03..10, WHK-18..30, WHK-31..32

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Lists webhooks from `GET /workspaces/:id/webhooks` showing URL, subscribed events and enabled state (WHK-01)
- [ ] Any non-2xx on the list renders the shared `nav.notFound` message, with no 403/404 distinction (WHK-03)
- [ ] An empty list renders `nav.webhooks.empty`, never a bare blank list (WHK-04)
- [ ] Create form offers exactly the 5 `WEBHOOK_EVENT_TYPES` as checkboxes (WHK-05)
- [ ] Blocks submit with no `POST` emitted when the URL is empty after `trim` (WHK-06) and when zero events are checked (WHK-07), each with its own message
- [ ] Valid submit emits `POST` with `{url, events}` (WHK-08); on 201 appends the returned webhook and clears the form (WHK-09); on non-201 announces failure and appends nothing (WHK-10)
- [ ] Inline edit emits `PATCH` with current `url`/`events`/`enabled` (WHK-18); emits nothing when nothing changed (WHK-19); reflects new values only after 200 (WHK-20); keeps previous values on non-200 (WHK-21)
- [ ] Enabled toggle emits `PATCH {enabled}` and flips only after 200 (WHK-22)
- [ ] Rotate requires in-row confirmation before any request (WHK-23); confirming emits `PATCH .../:webhookId:rotate-secret` (WHK-24); on 200 opens the secret panel with the new secret (WHK-25); on non-200 announces failure and opens no panel (WHK-26); cancelling emits nothing and restores the row (WHK-27)
- [ ] Remove opens `ConfirmArchiveDialog` with the webhook URL as `itemName` (WHK-28); confirming emits `DELETE` and on 204 drops the row (WHK-29); non-204 announces failure and keeps the row (WHK-30)
- [ ] A second create submit while one is in flight emits no second `POST` (edge case 1)
- [ ] A rotation while a create's secret panel is open replaces the shown secret, never stacking two panels (edge case 2)
- [ ] Unchecking the last event during an edit blocks the save with no `PATCH` emitted (edge case 4)
- [ ] `aria-live="polite"` region announces every outcome (WHK-32)
- [ ] Unit tests cover every bullet above
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add WorkspaceWebhooksPage`

---

### T5: Add `WorkspaceWebhooksPage` accessibility coverage

**What**: `WorkspaceWebhooksPage.a11y.spec.tsx`, mirroring the established `*.a11y.spec.tsx` convention.
**Where**: `apps/web/src/nav/WorkspaceWebhooksPage.a11y.spec.tsx`
**Depends on**: T4
**Reuses**: `WorkspaceMembersPage.a11y.spec.tsx`'s exact template — `jest-axe`, the local `seriousOrCriticalViolations` helper, the jsdom `<dialog>` shim, the `i18n.changeLanguage` restore in `afterEach`
**Requirement**: WHK-31..33

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `jest-axe` run in at least 3 states — populated list, secret panel open, rotate-confirmation open — each with zero serious/critical violations
- [ ] Explicit keyboard-focus assertions covering every interactive control of the page: back link, create URL input, event checkboxes, create submit, per-row edit/toggle/rotate/remove, secret-panel copy and dismiss, and the remove-dialog confirm button (WHK-31)
- [ ] Asserts the outcome region carries `aria-live="polite"` and receives a real announcement after a completed action (WHK-32)
- [ ] An explicit `en`-locale render test asserting English strings, alongside the default `pt-BR` (WHK-33)
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `test(web): add WorkspaceWebhooksPage accessibility coverage`

---

### T6: Wire the webhooks route and `ProjectListPage` link

**What**: Add `w/:workspaceId/webhooks` as a sibling nested route inside `AppShell`'s existing block; add a "Webhooks" link in `ProjectListPage` next to the existing "Members" link, gated on `workspace:manage_members`.
**Where**: `apps/web/src/App.tsx`, `apps/web/src/nav/ProjectListPage.tsx`
**Depends on**: T4
**Reuses**: the nested-route pattern established by `workspace-navigation` and reused by `workspace-members`' T6; `ProjectListPage`'s already-resolved `workspace.role` and its existing `can(...)` gating style
**Requirement**: WHK-02

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `/w/:workspaceId/webhooks` renders `WorkspaceWebhooksPage` inside the same `ProtectedRoute`/`AppShell` chrome as the other nav pages
- [ ] `ProjectListPage` shows a "Webhooks" link to `/w/:workspaceId/webhooks` when the caller's role grants `workspace:manage_members`, and shows no such link otherwise (WHK-02)
- [ ] Tests cover both the admin (link present) and non-admin (link absent) cases, plus the route rendering
- [ ] Full gate passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): wire WorkspaceWebhooksPage into routing and ProjectListPage`

---

## Phase Execution Map

```
T2 → T3
T1 → T4
T3 → T4
T4 → T5
T4 → T6
```

T1 and T2 have no incoming edges. Execution is strictly sequential, one task at a time, in the order T1, T2, T3, T4, T5, T6.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: `webhookClient` | 1 file | ✅ Granular |
| T2: `nav.webhooks` i18n keys | 2 locale files, 1 cohesive block | ✅ Granular |
| T3: `WebhookSecretPanel` | 1 component | ✅ Granular |
| T4: `WorkspaceWebhooksPage` | 1 component | ✅ Granular |
| T5: a11y test | 1 test file | ✅ Granular |
| T6: wire routing + link | 2 files, 1 cohesive integration | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ----------------------- | -------------- | ------ |
| T1 | None | No incoming edge | ✅ Match |
| T2 | None | No incoming edge | ✅ Match |
| T3 | T2 | T2→T3 | ✅ Match |
| T4 | T1, T3 | T1→T4, T3→T4 | ✅ Match |
| T5 | T4 | T4→T5 | ✅ Match |
| T6 | T4 | T4→T6 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | ----------------------------- | ----------------- | ----------- | ------ |
| T1 | Client (`webhookClient`) | unit | unit | ✅ OK |
| T2 | i18n JSON | none | none | ✅ OK |
| T3 | Component (`WebhookSecretPanel`) | unit | unit | ✅ OK |
| T4 | Component (`WorkspaceWebhooksPage`) | unit | unit | ✅ OK |
| T5 | Accessibility | unit (axe) | unit | ✅ OK |
| T6 | Integration wiring | unit (integration-style RTL) | unit | ✅ OK |

---

## Tips

(carried from the skill template — not repeated here)
