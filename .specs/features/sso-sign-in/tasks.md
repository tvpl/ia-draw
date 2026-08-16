# Entrada no produto (login e SSO) — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/sso-sign-in/design.md`
**Status**: Approved

---

## Test Coverage Matrix

> Generated from codebase sampling (`apps/server/src/modules/auth/auth.int.spec.ts`, `apps/server/src/modules/auth/oidc.int.spec.ts`, `apps/web/src/sync/syncClient.spec.ts`, `apps/web/src/a11y/shell.a11y.spec.tsx`) and this repo's coverage-floor convention (never lowered). Guidelines found: none beyond `CLAUDE.md`'s "Comandos" — strong default applied.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------- | --------------------- | ----------------- | ------------ |
| Server route (`GET /auth/oidc/status`) | integration | Both branches (`configured: true` with OIDC env set, `false` without), never 401/403 | `apps/server/src/modules/auth/auth.int.spec.ts` | `pnpm --filter @arch-canvas/server run test:integration` |
| Server route (`GET /auth/oidc/callback` failure paths) | integration | Every existing failure branch in `oidc.int.spec.ts`/`auth.int.spec.ts` re-asserted to redirect (302/303) to `${publicUrl}/login?error=oidc_failed` instead of throwing; audit event + metrics call still fire | `apps/server/src/modules/auth/oidc.int.spec.ts`, `auth.int.spec.ts` | `pnpm --filter @arch-canvas/server run test:integration` |
| Frontend context (`AuthProvider`/`useAuth`) | unit (RTL) | Every branch in design.md's sequence diagram: 200 on `/me`, 401→refresh-200→retry-200, 401→refresh-fail→anonymous | `apps/web/src/auth/AuthProvider.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Frontend guard (`ProtectedRoute`) | unit (RTL) | loading/authenticated/anonymous states, redirect target includes `next` | `apps/web/src/auth/ProtectedRoute.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| i18n JSON (`translation.json` × 2) | none | Build/lint gate only | `apps/web/src/i18n/locales/{en,pt-BR}/translation.json` | build gate only |
| Component (`LoginPage`) | unit (RTL) | 1:1 to spec ACs SSO-01..12 (render gating, submit, 401/400 handling, SSO visibility branches, error query param, next-param preservation, open-redirect guard) | `apps/web/src/auth/LoginPage.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Accessibility (`LoginPage`) | unit (axe) | Zero serious/critical violations; SSO-19..21 | `apps/web/src/auth/LoginPage.a11y.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Integration (`App.tsx` wiring + `DiagramEditorPage`) | unit (RTL) | End-to-end: anonymous access to a protected route redirects to `/login?next=...`; successful login returns to `next`; `DiagramEditorPage` reads `setActorId` from context, not a direct `/me` call | `apps/web/src/App.spec.tsx` (new) | `pnpm --filter @arch-canvas/web run test:unit` |
| Component (`AppShell` logout) | unit (RTL) | Logout button calls `POST /auth/logout` and redirects to `/login` | `apps/web/src/app-shell/AppShell.spec.tsx` (new, none exists today) | `pnpm --filter @arch-canvas/web run test:unit` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After a task with unit tests only, scoped to one package | `pnpm --filter @arch-canvas/<pkg> run test:unit` |
| Full | After a task with integration tests, or closing a phase | `make lint && make typecheck && make test-unit` (+ `make test-integration` for server tasks) |
| Build | Closing the feature | `make lint && make typecheck && make test-unit && make test-integration` |

---

## Execution Plan

### Phase 1: Servidor

```
T1
T2
```

### Phase 2: Substrato de autenticação (apps/web)

```
T3 → T4
T5
```

### Phase 3: Tela de login e integração

```
T1 → T6
T3 → T6
T5 → T6
T6 → T7
T4 → T8
T6 → T8
T3 → T9
```

---

## Task Breakdown

### T1: Add `GET /auth/oidc/status` route

**What**: New route returning `{ configured: boolean }` from `config.oidc !== undefined`, no auth required, no schema input.
**Where**: `apps/server/src/modules/auth/routes.ts`
**Depends on**: None
**Reuses**: existing `config.oidc` presence check already used by `GET /auth/oidc/login`
**Requirement**: SSO-09, SSO-11

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Route registered in `routeSchemas` and via `app.get`
- [x] Returns `200 { configured: true }` when `OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` are all set in the test's config; `200 { configured: false }` otherwise — never `401`/`403`/`503`
- [x] Integration tests added to `auth.int.spec.ts` covering both branches
- [x] Gate check passes: `pnpm --filter @arch-canvas/server run test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(auth): add GET /auth/oidc/status discovery route`

---

### T2: Redirect on OIDC callback failure instead of throwing

**What**: Every failure path in the `GET /auth/oidc/callback` handler (missing/malformed PKCE cookie, failed token exchange, any caught error) redirects to `${config.publicUrl}/login?error=oidc_failed` instead of rethrowing the raw error.
**Where**: `apps/server/src/modules/auth/routes.ts` (callback handler, ~line 218-327)
**Depends on**: None
**Reuses**: the existing success-path `reply.redirect(config.publicUrl)` in the same handler as the pattern to follow
**Requirement**: SSO-12

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Missing/expired PKCE cookie → redirect to `${publicUrl}/login?error=oidc_failed` (not a `400` body)
- [x] Malformed PKCE cookie JSON → same redirect
- [x] Token exchange / claims failure → same redirect; `recordAuditEvent(..., 'auth.oidc_login.failed')` and `metrics?.recordAuthFailure()` still called before the redirect (existing behavior preserved)
- [x] Success path (`reply.redirect(config.publicUrl)`) unchanged
- [x] `oidc.int.spec.ts`/`auth.int.spec.ts` failure-path assertions updated from "expect thrown error / problem+json" to "expect a redirect response whose `Location` header is `${publicUrl}/login?error=oidc_failed`"
- [x] Gate check passes: `pnpm --filter @arch-canvas/server run test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(auth): redirect to /login with an error param on OIDC callback failure`

---

### T3: Create `AuthProvider`/`useAuth`

**What**: React context provider resolving session on mount (`GET /me`, one `POST /auth/refresh` retry on 401), exposing `{ user, status }` and a `useLogout()` hook.
**Where**: `apps/web/src/auth/AuthProvider.tsx`
**Depends on**: None
**Reuses**: `fetchImpl`-injection style from `apps/web/src/sync/syncClient.ts`
**Requirement**: SSO-13..17

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `status` transitions `loading` → `authenticated` (200 on first `/me`) or `loading` → `authenticated` (401 → refresh 200 → retry `/me` 200) or `loading` → `anonymous` (refresh fails, or retried `/me` still fails)
- [x] `user` populated with exactly `{id, email, displayName}` from the response body, never more
- [x] `useLogout()` calls `POST /auth/logout`, then sets `status` to `anonymous`/`user` to `null`
- [x] Unit tests cover all 3 status-transition branches from design.md's sequence diagram, using an injected `fetchImpl`
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add AuthProvider and useAuth`

---

### T4: Create `ProtectedRoute`

**What**: Route guard component reading `useAuth()`, redirecting to `/login?next=<current path>` when anonymous, rendering `children` when authenticated, rendering nothing while loading.
**Where**: `apps/web/src/auth/ProtectedRoute.tsx`
**Depends on**: T3
**Reuses**: `useAuth()`, `react-router-dom`'s `useLocation`/`Navigate`
**Requirement**: SSO-13, SSO-16

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Renders `children` only when `status === 'authenticated'`
- [x] Redirects to `/login?next=<url-encoded current path+search>` when `status === 'anonymous'`
- [x] Renders nothing (not `children`, not a redirect) while `status === 'loading'`
- [x] Unit tests cover all 3 states
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add ProtectedRoute guard`

---

### T5: Add `auth` i18n keys (pt-BR, en)

**What**: New top-level `"auth": {...}` block in both locale files — labels, the generic invalid-credential message, the generic OIDC-failure message, SSO button label, logout label.
**Where**: `apps/web/src/i18n/locales/en/translation.json`, `apps/web/src/i18n/locales/pt-BR/translation.json`
**Depends on**: None
**Reuses**: existing nesting convention (`aiDock`, `saveStatus` blocks)
**Requirement**: SSO-19..21

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Both locale files have an identical key set under `auth`
- [x] Includes at minimum: `auth.emailLabel`, `auth.passwordLabel`, `auth.submit`, `auth.invalidCredentials`, `auth.ssoButton`, `auth.ssoFailed`, `auth.logout`
- [x] `make lint` passes

**Tests**: none (build gate only)
**Gate**: quick (`make lint`)

**Commit**: `feat(web): add auth i18n keys for pt-BR and en`

---

### T6: Create `LoginPage`

**What**: The login screen — local form, conditional SSO link, `?error=`/`?next=` handling, short-circuit redirect when already authenticated.
**Where**: `apps/web/src/auth/LoginPage.tsx`
**Depends on**: T1, T3, T5
**Reuses**: native HTML controls (`LanguageSwitcher.tsx` convention); `useAuth()`; `useTranslation()`
**Requirement**: SSO-01..08, SSO-10, SSO-12

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Already-authenticated visit to `/login` redirects immediately to `next` (or `/`) without rendering the form (SSO-02)
- [ ] Submit disabled until both fields are non-empty/non-whitespace (SSO-07); disabled again while a submit is in flight
- [ ] `POST /auth/login` sends `{email, password}`; `200` → redirect to `next` (validated same-origin, else `/` — SSO-04, Edge Case); `401`/`400` → single generic message, email preserved, password cleared, resubmit re-enabled (SSO-05, SSO-06)
- [ ] Calls `GET /auth/oidc/status` on mount; renders the SSO link (`<a href="/auth/oidc/login">`, real navigation, not `fetch`) only when `configured: true`; never renders it on `false` or on any fetch failure (SSO-09..11)
- [ ] `?error=oidc_failed` in the URL renders the generic SSO-failure message without blocking the local form or a configured SSO link (SSO-12)
- [ ] Unit tests cover every bullet above
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add LoginPage`

---

### T7: Add `LoginPage` accessibility test

**What**: `LoginPage.a11y.spec.tsx` asserting zero serious/critical axe violations in at least 2 states (form idle, error shown).
**Where**: `apps/web/src/auth/LoginPage.a11y.spec.tsx`
**Depends on**: T6
**Reuses**: `seriousOrCriticalViolations` helper pattern from `shell.a11y.spec.tsx`
**Requirement**: SSO-19..21

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `jest-axe` run against `LoginPage` in idle and error states
- [ ] Zero serious/critical violations in both
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `test(web): add LoginPage accessibility coverage`

---

### T8: Wire `AuthProvider`/`ProtectedRoute`/`/login` into `App.tsx`; update `DiagramEditorPage`

**What**: Mount `AuthProvider` at the top of `App.tsx`, add the `/login` route (unprotected), wrap the 2 existing routes in `ProtectedRoute`. `DiagramEditorPage` reads the user from `useAuth()` for `setActorId` instead of its own `fetch('/me')`.
**Where**: `apps/web/src/App.tsx`, `apps/web/src/diagram/DiagramEditorPage.tsx`
**Depends on**: T4, T6
**Reuses**: everything from T3/T4/T6
**Requirement**: SSO-13..18 (integration point)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `AuthProvider` wraps `<Routes>`; `/login` renders `LoginPage` unguarded; `/` and `/w/:workspaceId/d/:diagramId` wrapped in `ProtectedRoute`
- [ ] `DiagramEditorPage`'s own `fetch('/me')` call removed; `client.setActorId` now sourced from `useAuth().user.id`
- [ ] New `App.spec.tsx`: mocked `fetch` returning 401 on `/me` and failing `/auth/refresh` → visiting a protected route lands on `/login?next=<encoded path>`; a subsequent successful `POST /auth/login` returns to that `next`
- [ ] `repo-tools run audit` reflects `POST /auth/login`, `POST /auth/logout`, `POST /auth/refresh`, `GET /me`, `GET /auth/oidc/login`, `GET /auth/oidc/callback` as consumed (no longer `pending-product`), `GET /auth/oidc/status` listed as a new consumed route
- [ ] Full gate passes: `make lint && make typecheck && make test-unit`

**Tests**: unit (integration-style RTL)
**Gate**: full

**Commit**: `feat(web): wire AuthProvider and ProtectedRoute into the app shell`

---

### T9: Add logout control to `AppShell`

**What**: A single logout button in the existing `AppShell` stub, calling `useLogout()`.
**Where**: `apps/web/src/app-shell/AppShell.tsx`
**Depends on**: T3
**Reuses**: `useLogout()`
**Requirement**: (supporting SSO-13..18's session lifecycle — no dedicated AC, covered by Assumptions table's logout-location decision)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Button renders with an i18n label (`auth.logout`), keyboard-reachable
- [ ] Click calls `POST /auth/logout` via `useLogout()` and the app ends up on `/login` (via `ProtectedRoute` reacting to the now-anonymous state, or an explicit redirect in `useLogout()` — either is acceptable, whichever `useLogout()`'s T3 implementation already does)
- [ ] Unit test (new `AppShell.spec.tsx`, none exists today) covers the click → logout call → anonymous state transition
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add logout control to AppShell`

---

## Phase Execution Map

Only real `Depends on` edges shown (no phantom reading-order arrows):

```
T3 → T4
T1 → T6
T3 → T6
T5 → T6
T6 → T7
T4 → T8
T6 → T8
T3 → T9
```

T1, T2, T3, T5 have no incoming edges.

**Batching for sub-agent delegation** (9 tasks > ~8 → offer, already pre-authorized this session): Batch 1 = Phase 1 + Phase 2 (T1-T5, 5 tasks). Batch 2 = Phase 3 (T6-T9, 4 tasks) — depends on Batch 1's T1/T3/T5 outputs.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: `GET /auth/oidc/status` | 1 route, 1 file | ✅ Granular |
| T2: OIDC callback failure redirect | 1 handler's error paths, 1 file | ✅ Granular |
| T3: `AuthProvider`/`useAuth` | 1 provider, 1 file | ✅ Granular |
| T4: `ProtectedRoute` | 1 component, 1 file | ✅ Granular |
| T5: `auth` i18n keys | 2 JSON files, 1 cohesive key block (locale pair) | ✅ Granular |
| T6: `LoginPage` | 1 component, 1 file | ✅ Granular |
| T7: `LoginPage` a11y test | 1 test file | ✅ Granular |
| T8: Wire into `App.tsx` + `DiagramEditorPage` | 2 files, 1 cohesive integration | ✅ Granular |
| T9: `AppShell` logout | 1 component, 1 file | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ----------------------- | -------------- | ------ |
| T1 | None | No incoming edge | ✅ Match |
| T2 | None | No incoming edge | ✅ Match |
| T3 | None | No incoming edge | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | None | No incoming edge | ✅ Match |
| T6 | T1, T3, T5 | T1 → T6, T3 → T6, T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T4, T6 | T4 → T8, T6 → T8 | ✅ Match |
| T9 | T3 | T3 → T9 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | ----------------------------- | ----------------- | ----------- | ------ |
| T1 | Server route | integration | integration | ✅ OK |
| T2 | Server route (behavior change) | integration | integration | ✅ OK |
| T3 | Frontend context | unit | unit | ✅ OK |
| T4 | Frontend guard | unit | unit | ✅ OK |
| T5 | i18n JSON | none | none | ✅ OK |
| T6 | Component | unit | unit | ✅ OK |
| T7 | Accessibility | unit (axe) | unit | ✅ OK |
| T8 | Integration wiring | unit (integration-style RTL) | unit | ✅ OK |
| T9 | Component | unit | unit | ✅ OK |

---

## Tips

(carried from the skill template — not repeated here)
