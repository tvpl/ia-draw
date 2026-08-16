import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/index.js';
import { LoginPage } from './LoginPage.js';

// The shared i18next singleton defaults to pt-BR (`DEFAULT_LANGUAGE`) —
// pin to `en` so assertions below can match stable English strings instead
// of depending on whatever locale a previous test file left it in.
beforeAll(async () => {
  await i18n.changeLanguage('en');
});

// This repo has no `@testing-library/jest-dom` installed (confirmed absent
// from apps/web/package.json — same disclosure as AiDock.spec.tsx) — every
// assertion below uses plain DOM properties (`.disabled`, `.value`,
// `queryBy*` returning null) instead of jest-dom matchers.

const useAuthMock = vi.fn();

// `LoginPage` only ever reads `useAuth().status` — mocking the module keeps
// these tests from needing a real `AuthProvider` (and its own `/me` fetch
// dance) just to drive the loading/authenticated/anonymous branches.
vi.mock('./AuthProvider.js', () => ({
  useAuth: () => useAuthMock(),
}));

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function TargetProbe({ label }: { label: string }): JSX.Element {
  return <div>landed:{label}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<TargetProbe label="root" />} />
        <Route path="/w/:workspaceId/d/:diagramId" element={<TargetProbe label="next" />} />
      </Routes>
    </MemoryRouter>,
  );
}

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(handler) as unknown as typeof fetch);
}

// jsdom's real `window.location.assign` is non-configurable, so `vi.spyOn`
// can't wrap it directly — swap the whole `location` object for a stub with
// a spy-able `assign`, restored after each test (LoginPage never reads any
// other `location` property, so a minimal stub is sufficient).
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
  useAuthMock.mockReset();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
});

describe('LoginPage (T6, SSO-01..08/10/12)', () => {
  it('renders nothing while status is loading', () => {
    useAuthMock.mockReturnValue({ user: null, status: 'loading' });
    stubFetch(() => Promise.resolve(jsonResponse(200, { configured: false })));
    const { container } = renderAt('/login');
    expect(container.textContent).toBe('');
  });

  it('renders the email/password fields and a submit button, keyboard reachable, when anonymous', async () => {
    useAuthMock.mockReturnValue({ user: null, status: 'anonymous' });
    stubFetch(() => Promise.resolve(jsonResponse(200, { configured: false })));
    renderAt('/login');

    const emailInput = screen.getByLabelText('Email') as HTMLInputElement;
    const passwordInput = screen.getByLabelText('Password') as HTMLInputElement;
    const submit = screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement;

    expect(emailInput.tagName).toBe('INPUT');
    expect(passwordInput.tagName).toBe('INPUT');
    // SSO-07: disabled until both fields are non-empty.
    expect(submit.disabled).toBe(true);
  });

  it('already-authenticated visit to /login redirects immediately to next, without rendering the form', async () => {
    useAuthMock.mockReturnValue({
      user: { id: '1', email: 'a@b.com', displayName: 'A' },
      status: 'authenticated',
    });
    stubFetch(() => Promise.resolve(jsonResponse(200, { configured: false })));
    renderAt('/login?next=%2Fw%2Fws-1%2Fd%2Fdiag-1');

    await waitFor(() => expect(screen.getByText('landed:next')).toBeTruthy());
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('already-authenticated visit to /login with no next redirects to /', async () => {
    useAuthMock.mockReturnValue({
      user: { id: '1', email: 'a@b.com', displayName: 'A' },
      status: 'authenticated',
    });
    stubFetch(() => Promise.resolve(jsonResponse(200, { configured: false })));
    renderAt('/login');

    await waitFor(() => expect(screen.getByText('landed:root')).toBeTruthy());
  });

  it('open-redirect guard: an absolute next is ignored, falling back to /', async () => {
    useAuthMock.mockReturnValue({
      user: { id: '1', email: 'a@b.com', displayName: 'A' },
      status: 'authenticated',
    });
    stubFetch(() => Promise.resolve(jsonResponse(200, { configured: false })));
    renderAt(`/login?next=${encodeURIComponent('https://evil.example/steal')}`);

    await waitFor(() => expect(screen.getByText('landed:root')).toBeTruthy());
  });

  it('submit stays disabled until both fields are non-empty/non-whitespace', async () => {
    useAuthMock.mockReturnValue({ user: null, status: 'anonymous' });
    stubFetch(() => Promise.resolve(jsonResponse(200, { configured: false })));
    renderAt('/login');

    const emailInput = screen.getByLabelText('Email');
    const passwordInput = screen.getByLabelText('Password');
    const submit = screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement;

    fireEvent.change(emailInput, { target: { value: 'a@b.com' } });
    expect(submit.disabled).toBe(true);

    fireEvent.change(passwordInput, { target: { value: '   ' } });
    expect(submit.disabled).toBe(true);

    fireEvent.change(passwordInput, { target: { value: 'secret' } });
    expect(submit.disabled).toBe(false);
  });

  it('submits POST /auth/login with {email, password} and disables the button while in flight', async () => {
    useAuthMock.mockReturnValue({ user: null, status: 'anonymous' });
    let resolveLogin: (response: Response) => void = () => {};
    const loginPromise = new Promise<Response>((resolve) => {
      resolveLogin = resolve;
    });

    stubFetch((url, init) => {
      if (url === '/auth/oidc/status')
        return Promise.resolve(jsonResponse(200, { configured: false }));
      if (url === '/auth/login') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({ email: 'a@b.com', password: 'secret' });
        return loginPromise;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderAt('/login');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });

    const submit = screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    await waitFor(() => expect(submit.disabled).toBe(true));
    expect(screen.getByText('Signing in…')).toBeTruthy();

    await act(async () => {
      resolveLogin(jsonResponse(200, {}));
      await loginPromise;
    });

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/'));
  });

  it('200 response redirects to the sanitized next', async () => {
    useAuthMock.mockReturnValue({ user: null, status: 'anonymous' });
    stubFetch((url) => {
      if (url === '/auth/oidc/status')
        return Promise.resolve(jsonResponse(200, { configured: false }));
      if (url === '/auth/login') return Promise.resolve(jsonResponse(200, {}));
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderAt('/login?next=%2Fw%2Fws-1%2Fd%2Fdiag-1');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('/w/ws-1/d/diag-1'));
  });

  it('401 shows a single generic message, preserves email, clears password, re-enables submit', async () => {
    useAuthMock.mockReturnValue({ user: null, status: 'anonymous' });
    stubFetch((url) => {
      if (url === '/auth/oidc/status')
        return Promise.resolve(jsonResponse(200, { configured: false }));
      if (url === '/auth/login') return Promise.resolve(jsonResponse(401, {}));
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderAt('/login');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByText('Invalid email or password.')).toBeTruthy());
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('a@b.com');
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
    // Password is empty again post-clear, so the submit button re-disables —
    // "resubmit re-enabled" per SSO-05 means the *disabled-while-submitting*
    // lock is released, not that empty-field validation (SSO-07) is bypassed.
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'retry' } });
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('a network failure on POST /auth/login gets the same generic-message treatment', async () => {
    useAuthMock.mockReturnValue({ user: null, status: 'anonymous' });
    stubFetch((url) => {
      if (url === '/auth/oidc/status')
        return Promise.resolve(jsonResponse(200, { configured: false }));
      if (url === '/auth/login') return Promise.reject(new Error('network down'));
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderAt('/login');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByText('Invalid email or password.')).toBeTruthy());
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  });

  it('400 (malformed payload) gets the same generic-message treatment as 401', async () => {
    useAuthMock.mockReturnValue({ user: null, status: 'anonymous' });
    stubFetch((url) => {
      if (url === '/auth/oidc/status')
        return Promise.resolve(jsonResponse(200, { configured: false }));
      if (url === '/auth/login') return Promise.resolve(jsonResponse(400, {}));
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderAt('/login');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(screen.getByText('Invalid email or password.')).toBeTruthy());
  });

  it('a second submit while one is in flight does not emit a second POST /auth/login', async () => {
    useAuthMock.mockReturnValue({ user: null, status: 'anonymous' });
    let loginCalls = 0;
    let resolveLogin: (response: Response) => void = () => {};
    const loginPromise = new Promise<Response>((resolve) => {
      resolveLogin = resolve;
    });

    stubFetch((url) => {
      if (url === '/auth/oidc/status')
        return Promise.resolve(jsonResponse(200, { configured: false }));
      if (url === '/auth/login') {
        loginCalls += 1;
        return loginPromise;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderAt('/login');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });

    const form = screen.getByRole('button', { name: 'Sign in' }).closest('form');
    if (!form) throw new Error('form not found');

    fireEvent.submit(form);
    fireEvent.submit(form); // second click/submit while the first is still in flight

    expect(loginCalls).toBe(1);

    await act(async () => {
      resolveLogin(jsonResponse(200, {}));
      await loginPromise;
    });
  });

  it('shows the SSO link only when GET /auth/oidc/status resolves {configured: true}', async () => {
    useAuthMock.mockReturnValue({ user: null, status: 'anonymous' });
    stubFetch((url) => {
      if (url === '/auth/oidc/status')
        return Promise.resolve(jsonResponse(200, { configured: true }));
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderAt('/login');

    const link = await screen.findByRole('link', { name: 'Sign in with SSO' });
    expect(link.getAttribute('href')).toBe('/auth/oidc/login');
  });

  it('hides the SSO link when GET /auth/oidc/status resolves {configured: false}', async () => {
    useAuthMock.mockReturnValue({ user: null, status: 'anonymous' });
    stubFetch((url) => {
      if (url === '/auth/oidc/status')
        return Promise.resolve(jsonResponse(200, { configured: false }));
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderAt('/login');

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());
    expect(screen.queryByRole('link', { name: 'Sign in with SSO' })).toBeNull();
  });

  it('hides the SSO link when GET /auth/oidc/status fails on the network', async () => {
    useAuthMock.mockReturnValue({ user: null, status: 'anonymous' });
    stubFetch((url) => {
      if (url === '/auth/oidc/status') return Promise.reject(new Error('network down'));
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderAt('/login');

    await waitFor(() => expect(screen.getByLabelText('Email')).toBeTruthy());
    expect(screen.queryByRole('link', { name: 'Sign in with SSO' })).toBeNull();
  });

  it('?error=oidc_failed renders a generic SSO-failure message while keeping the local form (and a configured SSO link) available', async () => {
    useAuthMock.mockReturnValue({ user: null, status: 'anonymous' });
    stubFetch((url) => {
      if (url === '/auth/oidc/status')
        return Promise.resolve(jsonResponse(200, { configured: true }));
      throw new Error(`unexpected fetch: ${url}`);
    });

    renderAt('/login?error=oidc_failed');

    expect(screen.getByText('Corporate sign-in failed. Please try again.')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    await screen.findByRole('link', { name: 'Sign in with SSO' });
  });
});
