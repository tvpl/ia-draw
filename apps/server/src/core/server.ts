import { PROBLEM_CONTENT_TYPE, problem } from '@arch-canvas/shared-contracts';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { AppConfig } from './config.js';
import { buildLoggerOptions, type LoggerOverrides, REQUEST_ID_LOG_LABEL } from './logging.js';

export type DependencyStatus = 'up' | 'down';

export interface DependencyCheckResult {
  name: string;
  status: DependencyStatus;
}

/** Pluggable dependency ping, wired to real PG/MinIO clients once those exist. */
export interface DependencyCheck {
  name: string;
  check: () => Promise<boolean>;
}

export interface BuildServerOptions {
  /** Readiness dependency pings (stubbed until PG/MinIO clients land). */
  dependencyChecks?: DependencyCheck[];
  /** Injectable pino destination (OPS-05) — `logging.spec.ts` uses this to capture and assert on real log output instead of writing to the console. */
  loggerOverrides?: LoggerOverrides;
}

export function buildServer(config: AppConfig, options: BuildServerOptions = {}): FastifyInstance {
  const dependencyChecks = options.dependencyChecks ?? [];

  const app = Fastify({
    // Fastify's default logger is pino, which emits structured JSON logs.
    // buildLoggerOptions (OPS-05) adds secret/PII redaction and a requestId label.
    logger: buildLoggerOptions(config, options.loggerOverrides),
    requestIdLogLabel: REQUEST_ID_LOG_LABEL,
  });

  app.get('/health/live', async () => ({ status: 'ok' as const }));

  app.get('/health/ready', async (_request, reply) => {
    const dependencies: DependencyCheckResult[] = await Promise.all(
      dependencyChecks.map(async (dep): Promise<DependencyCheckResult> => {
        try {
          const ok = await dep.check();
          return { name: dep.name, status: ok ? 'up' : 'down' };
        } catch {
          return { name: dep.name, status: 'down' };
        }
      }),
    );

    const allUp = dependencies.every((dep) => dep.status === 'up');
    if (!allUp) {
      reply.code(503);
    }

    return { status: allUp ? ('ok' as const) : ('degraded' as const), dependencies };
  });

  app.setNotFoundHandler((request, reply) => {
    const body = problem(404, 'Not Found', { instance: request.url });
    reply.code(404).type(PROBLEM_CONTENT_TYPE).send(body);
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    // A request body/params/query failing zod validation is a client error
    // (400), never a 500 — routes call `schema.parse(...)` directly and
    // let this handler translate the thrown ZodError.
    if (error instanceof ZodError) {
      const body = problem(400, 'Validation Error', {
        detail: error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; '),
        instance: request.url,
      });
      reply.code(400).type(PROBLEM_CONTENT_TYPE).send(body);
      return;
    }

    const statusCode = error.statusCode ?? 500;
    const body = problem(statusCode, error.message || 'Internal Server Error', {
      instance: request.url,
    });
    reply.code(statusCode).type(PROBLEM_CONTENT_TYPE).send(body);
  });

  return app;
}

export interface GracefulShutdownOptions {
  signal?: NodeJS.Signals;
  /** Injectable emitter so tests can trigger shutdown without touching the real process. */
  target?: NodeJS.Process | NodeJS.EventEmitter;
  onShutdownComplete?: () => void;
}

/**
 * Closes the Fastify instance (drains connections) before the process exits.
 * Returns the registered handler so callers/tests can remove it if needed.
 */
export function registerGracefulShutdown(
  app: FastifyInstance,
  options: GracefulShutdownOptions = {},
): () => Promise<void> {
  const { signal = 'SIGTERM', target = process, onShutdownComplete } = options;

  const handler = async (): Promise<void> => {
    app.log.info({ signal }, 'shutdown signal received, draining connections');
    await app.close();
    onShutdownComplete?.();
  };

  target.once(signal, handler);

  return handler;
}
