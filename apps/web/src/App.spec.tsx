import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from './App.js';
// Side-effect import — initializes the shared i18next singleton, same
// convention as the other spec files. Default language is pt-BR
// (`DEFAULT_LANGUAGE`), so assertions below query the pt-BR strings
// ("E-mail", "Senha", "Entrar").
import './i18n/index.js';

// `EditorSurface`'s real `<Excalidraw/>` needs browser APIs jsdom doesn't
// implement — same mocking convention as `DiagramEditorPage.spec.tsx`.
vi.mock('@excalidraw/excalidraw', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@excalidraw/excalidraw')>();
  return {
    ...actual,
    Excalidraw: () => null,
  };
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Surfaces the current in-memory route (path+search) for assertions. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderApp(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationProbe />
      <AppRoutes />
    </MemoryRouter>,
  );
}

// jsdom's real `window.location.assign` is non-configurable — same stub
// strategy as `LoginPage.spec.tsx`: swap the whole `location` object for one
// with a spy-able `assign` (this file uses `MemoryRouter`, not
// `BrowserRouter`, so replacing `window.location` never interferes with
// routing — `MemoryRouter` keeps its own in-memory history, it never reads
// `window.location`).
const originalLocation = window.location;
let assignMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  assignMock = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign: assignMock },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
});

describe('App wiring (T8, SSO-13..18 integration)', () => {
  it('anonymous access to a protected route redirects to /login?next=<encoded path>', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/me') return Promise.resolve(jsonResponse(401, {}));
        if (url === '/auth/refresh') return Promise.resolve(jsonResponse(401, {}));
        if (url === '/auth/oidc/status')
          return Promise.resolve(jsonResponse(200, { configured: false }));
        if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch,
    );

    renderApp('/w/ws-1/d/diag-1');

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/login?next=%2Fw%2Fws-1%2Fd%2Fdiag-1',
      ),
    );
  });

  it('anonymous access to / also redirects to /login (default next)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/me') return Promise.resolve(jsonResponse(401, {}));
        if (url === '/auth/refresh') return Promise.resolve(jsonResponse(401, {}));
        if (url === '/auth/oidc/status')
          return Promise.resolve(jsonResponse(200, { configured: false }));
        if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch,
    );

    renderApp('/');

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/login?next=%2F'));
  });

  it('a subsequent successful POST /auth/login returns to the original next', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/me') return Promise.resolve(jsonResponse(401, {}));
        if (url === '/auth/refresh') return Promise.resolve(jsonResponse(401, {}));
        if (url === '/auth/oidc/status')
          return Promise.resolve(jsonResponse(200, { configured: false }));
        if (url === '/auth/login') {
          expect(init?.method).toBe('POST');
          return Promise.resolve(jsonResponse(200, {}));
        }
        if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch,
    );

    renderApp('/w/ws-1/d/diag-1');

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/login?next=%2Fw%2Fws-1%2Fd%2Fdiag-1',
      ),
    );

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'secret' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
      await Promise.resolve();
    });

    // The redirect target this component-under-test's real navigation aims
    // at (a hard navigation, since only that forces `AuthProvider` to
    // re-resolve the session it settled on at boot — see LoginPage.tsx) is
    // exactly the decoded `next` this test's protected-route visit produced
    // above, never `/`.
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/w/ws-1/d/diag-1'));
  });

  it("DiagramEditorPage reads the actor id from AuthProvider's context, never calling /me itself", async () => {
    let meCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/me') {
          meCalls += 1;
          return Promise.resolve(
            jsonResponse(200, { user: { id: 'user-1', email: 'a@b.com', displayName: 'A' } }),
          );
        }
        if (url === '/diagrams/diag-1/bootstrap') {
          return Promise.resolve(
            jsonResponse(200, {
              scene: [],
              revision: 1,
              assets: [],
              permissions: { allowed: true, reason: '' },
              mutatePermissions: { allowed: true, reason: '' },
            }),
          );
        }
        if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch,
    );

    renderApp('/w/ws-1/d/diag-1');

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/w/ws-1/d/diag-1'),
    );
    // `AuthProvider` calls `/me` exactly once to resolve the session that
    // let `ProtectedRoute` render this route at all; `DiagramEditorPage`
    // must never call it again for its own `setActorId`.
    await waitFor(() => expect(meCalls).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(meCalls).toBe(1);
  });
});

/** `/me` mock shared by the T11 nested-routing tests below — every one of them needs an authenticated session before `ProtectedRoute` renders `AppShell`. */
function authenticatedMe() {
  return jsonResponse(200, { user: { id: 'user-1', email: 'a@b.com', displayName: 'A' } });
}

describe('T11: nested workspace/project/diagram routes render inside AppShell per URL depth', () => {
  it('/ renders WorkspaceListPage (index) inside AppShell chrome', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/me') return Promise.resolve(authenticatedMe());
        if (url === '/workspaces')
          return Promise.resolve(
            jsonResponse(200, {
              items: [
                {
                  id: 'ws-1',
                  organizationId: 'org-1',
                  name: 'Acme Workspace',
                  slug: 'acme',
                  accessPolicy: null,
                  createdAt: '',
                  updatedAt: '',
                  role: 'workspace_admin',
                },
              ],
            }),
          );
        if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch,
    );

    renderApp('/');

    // AppShell's own chrome (T11's parent route) renders alongside the nested page.
    expect(await screen.findByRole('heading', { name: 'Architecture Canvas' })).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Acme Workspace' })).toBeTruthy();
  });

  it('/w/:workspaceId renders ProjectListPage inside AppShell chrome', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/me') return Promise.resolve(authenticatedMe());
        if (url === '/workspaces/ws-1')
          return Promise.resolve(
            jsonResponse(200, {
              workspace: { id: 'ws-1', name: 'Acme Workspace', role: 'editor' },
            }),
          );
        if (url === '/projects?workspaceId=ws-1')
          return Promise.resolve(
            jsonResponse(200, { items: [{ id: 'p-1', workspaceId: 'ws-1', name: 'Project One' }] }),
          );
        if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch,
    );

    renderApp('/w/ws-1');

    expect(await screen.findByRole('heading', { name: 'Architecture Canvas' })).toBeTruthy();
    expect(await screen.findByText('Acme Workspace')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Project One' })).toBeTruthy();
  });

  it('/w/:workspaceId/members renders WorkspaceMembersPage inside AppShell chrome (MEM-01, T6)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/me') return Promise.resolve(authenticatedMe());
        if (url === '/workspaces/ws-1/members')
          return Promise.resolve(
            jsonResponse(200, {
              items: [
                {
                  userId: 'user-1',
                  workspaceId: 'ws-1',
                  role: 'viewer',
                  email: 'a@b.com',
                  displayName: 'A',
                },
              ],
            }),
          );
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch,
    );

    renderApp('/w/ws-1/members');

    expect(await screen.findByRole('heading', { name: 'Architecture Canvas' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Membros' })).toBeTruthy();
    expect(screen.getByText('a@b.com')).toBeTruthy();
  });

  it('/w/:workspaceId/p/:projectId renders DiagramListPage inside AppShell chrome', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/me') return Promise.resolve(authenticatedMe());
        if (url === '/projects/p-1')
          return Promise.resolve(
            jsonResponse(200, { project: { id: 'p-1', workspaceId: 'ws-1', name: 'Project One' } }),
          );
        if (url === '/workspaces/ws-1')
          return Promise.resolve(
            jsonResponse(200, {
              workspace: { id: 'ws-1', name: 'Acme Workspace', role: 'editor' },
            }),
          );
        if (url === '/diagrams?projectId=p-1')
          return Promise.resolve(
            jsonResponse(200, { items: [{ id: 'd-1', projectId: 'p-1', title: 'Diagram One' }] }),
          );
        if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch,
    );

    renderApp('/w/ws-1/p/p-1');

    expect(await screen.findByRole('heading', { name: 'Architecture Canvas' })).toBeTruthy();
    expect(await screen.findByText('Project One')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Diagram One' })).toBeTruthy();
  });

  it('/w/:workspaceId/d/:diagramId still renders bare DiagramEditorPage, with no AppShell chrome', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/me') return Promise.resolve(authenticatedMe());
        if (url === '/diagrams/diag-1/bootstrap')
          return Promise.resolve(
            jsonResponse(200, {
              scene: [],
              revision: 1,
              assets: [],
              permissions: { allowed: true, reason: '' },
              mutatePermissions: { allowed: true, reason: '' },
            }),
          );
        if (url.startsWith('/libraries')) return Promise.resolve(jsonResponse(200, { items: [] }));
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch,
    );

    renderApp('/w/ws-1/d/diag-1');

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/w/ws-1/d/diag-1'),
    );
    // AppShell's chrome (header/logout button) never renders on the unnested editor route.
    expect(screen.queryByRole('heading', { name: 'Architecture Canvas' })).toBeNull();
  });

  it('/w/:workspaceId/d/:diagramId/inventory renders InventoryPage, also with no AppShell chrome (T8, CLIB-14)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/me') return Promise.resolve(authenticatedMe());
        if (url === '/diagrams/diag-1/inventory?format=json') {
          return Promise.resolve(
            jsonResponse(200, {
              items: [
                {
                  elementId: 'el-1',
                  elementType: 'rectangle',
                  semanticType: 'service',
                  metadataJson: {},
                  revision: 1,
                },
              ],
            }),
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch,
    );

    renderApp('/w/ws-1/d/diag-1/inventory');

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/w/ws-1/d/diag-1/inventory'),
    );
    expect(await screen.findByText('el-1')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Architecture Canvas' })).toBeNull();
    // The way back into the editor this diagram's inventory belongs to.
    const backLink = screen.getByRole('link', { name: 'Voltar' }) as HTMLAnchorElement;
    expect(backLink.getAttribute('href')).toBe('/w/ws-1/d/diag-1');
  });
});
