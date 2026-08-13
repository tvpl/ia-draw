import { EventEmitter } from 'node:events';
import { problemDetailsSchema } from '@arch-canvas/shared-contracts';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { InMemoryRateLimiter } from './rateLimit.js';
import { buildServer, registerGracefulShutdown } from './server.js';

function testConfig() {
  return loadConfig({ NODE_ENV: 'test' });
}

describe('buildServer (spec §11 / FND-05)', () => {
  it('boots and responds to a request (happy boot)', async () => {
    const app = buildServer(testConfig());
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('GET /health/live always responds 200', async () => {
    const app = buildServer(testConfig());
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('rejects a request body over 10 MB with 413, before any route handler runs (spec.md Edge Cases — oversized import/archive)', async () => {
    const app = buildServer(testConfig());
    app.post('/__body-limit-test', async () => ({ ok: true }));

    const oversized = 'x'.repeat(10 * 1024 * 1024 + 1);
    const response = await app.inject({
      method: 'POST',
      url: '/__body-limit-test',
      payload: oversized,
      headers: { 'content-type': 'text/plain' },
    });

    expect(response.statusCode).toBe(413);
    await app.close();
  });

  it('GET /health/ready responds 200 with status ok when all dependencies are reachable', async () => {
    const app = buildServer(testConfig(), {
      dependencyChecks: [{ name: 'postgres', check: async () => true }],
    });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      dependencies: [{ name: 'postgres', status: 'up' }],
    });
    await app.close();
  });

  it('GET /health/ready reports degraded (503) when a dependency check fails', async () => {
    const app = buildServer(testConfig(), {
      dependencyChecks: [
        { name: 'postgres', check: async () => true },
        { name: 'minio', check: async () => false },
      ],
    });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'degraded',
      dependencies: [
        { name: 'postgres', status: 'up' },
        { name: 'minio', status: 'down' },
      ],
    });
    await app.close();
  });

  it('GET /health/ready reports the dependency as down when its check throws', async () => {
    const app = buildServer(testConfig(), {
      dependencyChecks: [
        {
          name: 'postgres',
          check: async () => {
            throw new Error('connection refused');
          },
        },
      ],
    });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'degraded',
      dependencies: [{ name: 'postgres', status: 'down' }],
    });
    await app.close();
  });

  it('maps a thrown ZodError to 400 problem+json instead of 500', async () => {
    const app = buildServer(testConfig());
    app.get('/zod-throws', async () => {
      z.object({ id: z.string() }).parse({});
    });

    const response = await app.inject({ method: 'GET', url: '/zod-throws' });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    const parsed = problemDetailsSchema.safeParse(response.json());
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.status).toBe(400);
    await app.close();
  });

  it('serves error responses as application/problem+json via shared-contracts', async () => {
    const app = buildServer(testConfig());
    const response = await app.inject({ method: 'GET', url: '/does-not-exist' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    const parsed = problemDetailsSchema.safeParse(response.json());
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.status).toBe(404);
    await app.close();
  });
});

describe('security headers and CORS (SEC-01, T82)', () => {
  it('carries CSP, X-Content-Type-Options, and X-Frame-Options on every response', async () => {
    const app = buildServer(testConfig());
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
    await app.close();
  });

  it('omits Strict-Transport-Security when publicUrl is http (dev default)', async () => {
    const app = buildServer(loadConfig({ NODE_ENV: 'test', PUBLIC_URL: 'http://localhost:3000' }));
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.headers['strict-transport-security']).toBeUndefined();
    await app.close();
  });

  it('adds Strict-Transport-Security when publicUrl is https', async () => {
    const app = buildServer(
      loadConfig({ NODE_ENV: 'test', PUBLIC_URL: 'https://app.example.com' }),
    );
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.headers['strict-transport-security']).toContain('max-age=');
    await app.close();
  });

  it('never reflects a cross-site origin outside the (default empty) allowlist', async () => {
    const app = buildServer(testConfig());
    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { origin: 'https://not-allowed.example.com' },
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('reflects an origin explicitly present in CORS_ALLOWED_ORIGINS', async () => {
    const app = buildServer(
      loadConfig({ NODE_ENV: 'test', CORS_ALLOWED_ORIGINS: 'https://allowed.example.com' }),
    );
    const response = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { origin: 'https://allowed.example.com' },
    });
    expect(response.headers['access-control-allow-origin']).toBe('https://allowed.example.com');
    await app.close();
  });
});

/**
 * A minimal stand-in for `auth/middleware.ts`'s `requireSession` — same
 * function NAME (`requireSessionPreHandler`), which is exactly what
 * `core/server.ts`'s `onRoute` hook matches on to decide a route is
 * "authenticated" and append the default rate-limit check after it. Avoids
 * pulling in a real `Db`/session just to prove the wiring.
 */
function fakeRequireSession(
  userId: string | ((request: { headers: Record<string, unknown> }) => string),
) {
  return async function requireSessionPreHandler(request: {
    authContext?: { user: { id: string }; sessionId: string };
    headers: Record<string, unknown>;
  }): Promise<void> {
    const resolvedId = typeof userId === 'function' ? userId(request) : userId;
    request.authContext = { user: { id: resolvedId } as never, sessionId: 'test-session' };
  };
}

describe('default rate limiting for authenticated routes (SEC-02, T83)', () => {
  it('returns 429 once the injected default limiter is exceeded, keyed by userId', async () => {
    const limiter = new InMemoryRateLimiter({ limit: 2, windowMs: 60_000 });
    const app = buildServer(testConfig(), { defaultRateLimiter: limiter });
    app.get('/__protected-route-test', { preHandler: fakeRequireSession('user-1') }, async () => ({
      ok: true,
    }));

    const first = await app.inject({ method: 'GET', url: '/__protected-route-test' });
    const second = await app.inject({ method: 'GET', url: '/__protected-route-test' });
    const third = await app.inject({ method: 'GET', url: '/__protected-route-test' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(429);
    await app.close();
  });

  it('never rate-limits a route with no requireSession preHandler (e.g. /health/live)', async () => {
    const limiter = new InMemoryRateLimiter({ limit: 1, windowMs: 60_000 });
    const app = buildServer(testConfig(), { defaultRateLimiter: limiter });

    for (let i = 0; i < 5; i += 1) {
      const response = await app.inject({ method: 'GET', url: '/health/live' });
      expect(response.statusCode).toBe(200);
    }
    await app.close();
  });

  it('tracks distinct users independently — one user exhausting the limit never blocks another', async () => {
    const limiter = new InMemoryRateLimiter({ limit: 1, windowMs: 60_000 });
    const app = buildServer(testConfig(), { defaultRateLimiter: limiter });
    app.get(
      '/__protected-route-test',
      { preHandler: fakeRequireSession((request) => String(request.headers['x-test-user'])) },
      async () => ({ ok: true }),
    );

    const userA1 = await app.inject({
      method: 'GET',
      url: '/__protected-route-test',
      headers: { 'x-test-user': 'user-a' },
    });
    const userA2 = await app.inject({
      method: 'GET',
      url: '/__protected-route-test',
      headers: { 'x-test-user': 'user-a' },
    });
    const userB1 = await app.inject({
      method: 'GET',
      url: '/__protected-route-test',
      headers: { 'x-test-user': 'user-b' },
    });

    expect(userA1.statusCode).toBe(200);
    expect(userA2.statusCode).toBe(429);
    expect(userB1.statusCode).toBe(200);
    await app.close();
  });
});

describe('registerGracefulShutdown (spec §11 / FND-05)', () => {
  it('closes the Fastify instance (drains connections) when SIGTERM fires, before signalling exit', async () => {
    const app = buildServer(testConfig());
    const closeSpy = vi.spyOn(app, 'close');
    const target = new EventEmitter();
    const onShutdownComplete = vi.fn();

    registerGracefulShutdown(app, { target, onShutdownComplete });

    await new Promise<void>((resolve) => {
      onShutdownComplete.mockImplementation(() => resolve());
      target.emit('SIGTERM');
    });

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(onShutdownComplete).toHaveBeenCalledTimes(1);
    // The instance must be closed (connections drained) BEFORE exit is signalled.
    const closeOrder = closeSpy.mock.invocationCallOrder[0];
    const exitOrder = onShutdownComplete.mock.invocationCallOrder[0];
    expect(closeOrder).toBeLessThan(exitOrder as number);
  });
});
