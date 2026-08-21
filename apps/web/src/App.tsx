import type { JSX } from 'react';
import { BrowserRouter, Outlet, Route, Routes } from 'react-router-dom';
import { AppShell } from './app-shell/AppShell.js';
import { AuthProvider } from './auth/AuthProvider.js';
import { LoginPage } from './auth/LoginPage.js';
import { ProtectedRoute } from './auth/ProtectedRoute.js';
import { DiagramEditorPage } from './diagram/DiagramEditorPage.js';
import { InventoryPage } from './diagram/InventoryPage.js';
import { AiProviderAdminPage } from './nav/AiProviderAdminPage.js';
import { DiagramListPage } from './nav/DiagramListPage.js';
import { ProjectListPage } from './nav/ProjectListPage.js';
import { WorkspaceListPage } from './nav/WorkspaceListPage.js';
import { WorkspaceMembersPage } from './nav/WorkspaceMembersPage.js';
import { WorkspaceWebhooksPage } from './nav/WorkspaceWebhooksPage.js';
import { PresentationEditorPage } from './presentation/PresentationEditorPage.js';
import { PresentationListPage } from './presentation/PresentationListPage.js';
import { PresenterModePage } from './presentation/PresenterModePage.js';
import { SharedResourcePage } from './share/SharedResourcePage.js';

/**
 * Pathless layout route that scopes `AuthProvider` to the authenticated half of
 * the route table (AD-012). Every route that needs a session renders through this
 * `<Outlet/>`; a public route is registered as its SIBLING, never inside it, so
 * nothing above a public page can resolve `GET /me` or redirect to `/login`.
 */
function AuthLayout(): JSX.Element {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

/**
 * The route table itself, router-agnostic (T8, SSO-13..18) — split out from
 * `App` so tests can mount it inside a `MemoryRouter` instead of `App`'s real
 * `BrowserRouter` (see `App.spec.tsx`). `/login` is the only unguarded
 * route; `/` and the diagram editor route are wrapped in `ProtectedRoute`,
 * with `AuthProvider` mounted once above all of them (AD-011).
 *
 * T11 (workspace-navigation): `/` is now a parent route rendering `AppShell`'s
 * `<Outlet/>`, with three nested children mirroring the workspace -> project ->
 * diagram hierarchy — `index` (`WorkspaceListPage`), `w/:workspaceId`
 * (`ProjectListPage`), `w/:workspaceId/p/:projectId` (`DiagramListPage`). The
 * diagram-editor route stays an unnested sibling, unchanged: it renders bare,
 * without `AppShell`'s chrome.
 *
 * T6 (workspace-members): `w/:workspaceId/members` (`WorkspaceMembersPage`) joins
 * as a fourth nested child, a sibling of `w/:workspaceId`/`w/:workspaceId/p/:projectId`
 * rather than nested under either — membership is a workspace-level concern, not
 * scoped to a project.
 *
 * T9 (ai-provider-admin): `admin/ai-providers` and `w/:workspaceId/admin/ai-providers`
 * join as two more nested children — one component serving both, parameterized by
 * the scope it reads from `useParams()`. `admin/ai-providers` is the app's first
 * authenticated route with no workspace in its URL at all: the `"global"` provider
 * scope is instance-wide, so there is no workspace to nest it under.
 *
 * T8 (component-library): `/w/:workspaceId/d/:diagramId/inventory` is a second
 * unnested sibling, same tier as the editor route — `InventoryView` never mounts
 * the canvas (design.md), so it gets its own bare route instead of a mode inside
 * `DiagramEditorPage`; `DiagramEditorPage` links into it.
 *
 * T8 (presentation-mode): `/w/:workspaceId/d/:diagramId/present` joins as a third
 * unnested sibling of the same tier, same rationale as `/inventory` — the
 * presentation editor is its own surface, not a mode inside `DiagramEditorPage`.
 * `/present/:presentationId` (the presentation editor itself, T9-T14) and
 * `/present/:presentationId/presenter` (tela cheia, T19 — no `AppShell` at all,
 * a `ProtectedRoute` still guards it since it reads the live diagram scene) join
 * as two more unnested siblings, same tier again.
 *
 * T6 (workspace-webhooks): `w/:workspaceId/webhooks` (`WorkspaceWebhooksPage`)
 * joins as a fifth nested child, on the same level as `members` — webhooks are
 * a workspace-level integration concern. Unlike `members`, its entry link is
 * admin-only, because every one of its server routes is (WHK-02).
 *
 * T10 (share-links): `AuthProvider` is no longer the outermost wrapper. It now sits
 * on a pathless layout route (`AuthLayout`) covering every authenticated route,
 * exactly as before for all of them, while `/share/:token` is registered as that
 * layout route's SIBLING — the first page in this app that works with no session
 * (AD-012, SHR-12/13).
 */
export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route path="/share/:token" element={<SharedResourcePage />} />
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<WorkspaceListPage />} />
          <Route path="w/:workspaceId" element={<ProjectListPage />} />
          <Route path="w/:workspaceId/members" element={<WorkspaceMembersPage />} />
          <Route path="w/:workspaceId/webhooks" element={<WorkspaceWebhooksPage />} />
          <Route path="w/:workspaceId/p/:projectId" element={<DiagramListPage />} />
          <Route path="admin/ai-providers" element={<AiProviderAdminPage />} />
          <Route path="w/:workspaceId/admin/ai-providers" element={<AiProviderAdminPage />} />
        </Route>
        <Route
          path="/w/:workspaceId/d/:diagramId"
          element={
            <ProtectedRoute>
              <DiagramEditorPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/w/:workspaceId/d/:diagramId/inventory"
          element={
            <ProtectedRoute>
              <InventoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/w/:workspaceId/d/:diagramId/present"
          element={
            <ProtectedRoute>
              <PresentationListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/w/:workspaceId/d/:diagramId/present/:presentationId"
          element={
            <ProtectedRoute>
              <PresentationEditorPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/w/:workspaceId/d/:diagramId/present/:presentationId/presenter"
          element={
            <ProtectedRoute>
              <PresenterModePage />
            </ProtectedRoute>
          }
        />
      </Route>
    </Routes>
  );
}

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
