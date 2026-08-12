import { EventEmitter } from 'node:events';
import { problemDetailsSchema } from '@arch-canvas/shared-contracts';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
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
