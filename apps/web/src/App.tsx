import type { JSX } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
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
 * T6 (workspace-webhooks): `w/:workspaceId/webhooks` (`WorkspaceWebhooksPage`)
 * joins as a fifth nested child, on the same level as `members` — webhooks are
 * a workspace-level integration concern. Unlike `members`, its entry link is
 * admin-only, because every one of its server routes is (WHK-02).
 */
export function AppRoutes(): JSX.Element {
  return (
    <AuthProvider>
      <Routes>
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
      </Routes>
    </AuthProvider>
  );
}

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
