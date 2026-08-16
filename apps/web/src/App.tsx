import type { JSX } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './app-shell/AppShell.js';
import { AuthProvider } from './auth/AuthProvider.js';
import { LoginPage } from './auth/LoginPage.js';
import { ProtectedRoute } from './auth/ProtectedRoute.js';
import { DiagramEditorPage } from './diagram/DiagramEditorPage.js';

/**
 * The route table itself, router-agnostic (T8, SSO-13..18) — split out from
 * `App` so tests can mount it inside a `MemoryRouter` instead of `App`'s real
 * `BrowserRouter` (see `App.spec.tsx`). `/login` is the only unguarded
 * route; `/` and the diagram editor route are wrapped in `ProtectedRoute`,
 * with `AuthProvider` mounted once above all of them (AD-011).
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
        />
        <Route
          path="/w/:workspaceId/d/:diagramId"
          element={
            <ProtectedRoute>
              <DiagramEditorPage />
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
