import { PROBLEM_CONTENT_TYPE, problem } from '@arch-canvas/shared-contracts';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
// Type-only augmentation (`declare module 'fastify' { interface FastifyRequest { authContext } }`)
// — same side-effect-only import every route module already uses to type
// `request.authContext`; erased at compile time, no runtime coupling from
// `core` into `modules/auth`. Needed here because SEC-02's default rate
// limit keys off `request.authContext?.user?.id` (see below).
import '../modules/auth/types.js';
import type { AppConfig } from './config.js';
import { buildLoggerOptions, type LoggerOverrides, REQUEST_ID_LOG_LABEL } from './logging.js';
import { createRateLimitPreHandler, InMemoryRateLimiter } from './rateLimit.js';

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
  /**
   * Injectable default rate limiter (SEC-02, T83) — defaults to a generous
   * production limit. Tests that need to observe a 429 without issuing
   * hundreds of requests inject a tiny limiter here instead.
   */
  defaultRateLimiter?: InMemoryRateLimiter;
}

/**
 * Caps every request body at 10 MB — generous for a large diagram import (spec.md's
 * own scale target is ~5,000 elements) while bounding memory/CPU cost from an
 * oversized payload. Defense in depth for the "uploaded archive/import expands
 * beyond a reasonable size" edge case (spec.md Edge Cases) ahead of Fastify's
 * un-configured 1 MB default, which is too tight for legitimate large imports.
 */
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

/** Default per-key limit for any authenticated route with no route-specific stricter limit (SEC-02). Generous enough not to trip on ordinary usage or on this codebase's own test suites, which reuse one session across many requests within a single test/file. */
const DEFAULT_RATE_LIMIT_OPTIONS = { limit: 300, windowMs: 60_000 };

export function buildServer(config: AppConfig, options: BuildServerOptions = {}): FastifyInstance {
  const dependencyChecks = options.dependencyChecks ?? [];
  const defaultRateLimiter =
    options.defaultRateLimiter ?? new InMemoryRateLimiter(DEFAULT_RATE_LIMIT_OPTIONS);

  const app = Fastify({
    // Fastify's default logger is pino, which emits structured JSON logs.
    // buildLoggerOptions (OPS-05) adds secret/PII redaction and a requestId label.
    logger: buildLoggerOptions(config, options.loggerOverrides),
    requestIdLogLabel: REQUEST_ID_LOG_LABEL,
    bodyLimit: MAX_REQUEST_BODY_BYTES,
  });

  // SEC-01: security response headers (CSP, X-Content-Type-Options,
  // X-Frame-Options, and HSTS when reachable over https) on every response.
  // `apps/server` never itself serves HTML/inline scripts to a browser (it's
  // a REST+WS JSON API), so the default CSP directives (`default-src 'self'`
  // and friends, no `unsafe-inline` anywhere) are already restrictive without
  // needing route-specific loosening — confirmed by this file's own
  // integration coverage exercising the existing REST/WS routes under it.
  app.register(fastifyHelmet, {
    // HSTS only makes sense — and is only opted into — when the server is
    // actually reachable over https (config.publicUrl's scheme); forcing it
    // over plain http (local dev) would be actively misleading.
    hsts: config.publicUrl.startsWith('https:')
      ? { maxAge: 15_552_000, includeSubDomains: true }
      : false,
  });

  // SEC-01: explicit origin allowlist — empty by default, so no cross-site
  // origin is permitted until an operator opts one in via
  // `CORS_ALLOWED_ORIGINS`. Passing the (possibly empty) array directly as
  // `origin` means a request from an origin outside the allowlist never gets
  // a matching `Access-Control-Allow-Origin` back, without disabling the
  // plugin outright (so `credentials`/`methods` stay configurable per the
  // documented API if a future task needs them).
  app.register(fastifyCors, {
    origin: config.corsAllowedOrigins,
  });

  // SEC-02: a default rate limit on every authenticated route (key =
  // userId, falling back to ip) — reuses the same `InMemoryRateLimiter`
  // stricter, route-specific limits on `POST /diagrams/:id/ai/runs`
  // (ai-engine/routes.ts) and the export routes (export/routes.ts) layer
  // on top of, per SEC-02/AIC-04's disclosed-partial gap now closed.
  //
  // Structural note: a global `onRequest`/`preHandler` hook added here
  // would run BEFORE any route's own `preHandler` array (Fastify's
  // documented hook order: globally-registered hooks in a phase run before
  // a route's own same-phase handlers), so at that point `requireSession`'s
  // preHandler hasn't run yet and `request.authContext` is never set —
  // only `request.ip` would ever be available, defeating "key = userId".
  // Instead this uses Fastify's `onRoute` hook (fires once per route at
  // registration time, not per request) to detect routes whose own
  // `preHandler` chain already includes `requireSession`'s preHandler
  // (matched by its stable function name — `middleware.ts`'s
  // `requireSessionPreHandler`), and appends the rate-limit check
  // immediately after it in that same chain, so it runs once
  // `authContext` is populated. This automatically covers every current
  // and future route registered with `requireSession`, with zero
  // additional per-route wiring (L-008), which a plain global hook
  // structurally could not do.
  const defaultRateLimitPreHandler = createRateLimitPreHandler(
    defaultRateLimiter,
    (request) => request.authContext?.user?.id ?? request.ip,
  );
  app.addHook('onRoute', (routeOptions) => {
    const existingRaw = routeOptions.preHandler;
    const existing: unknown[] =
      existingRaw === undefined ? [] : Array.isArray(existingRaw) ? existingRaw : [existingRaw];
    const isAuthenticated = existing.some(
      (handler) => typeof handler === 'function' && handler.name === 'requireSessionPreHandler',
    );
    if (isAuthenticated) {
      // Fastify's own `preHandler` type is a union of many compatible hook
      // signatures (sync/async, arity variants) that doesn't unify cleanly
      // through a generic array — this narrow, documented escape hatch
      // avoids `any` while still appending a genuinely compatible handler
      // (`defaultRateLimitPreHandler` matches `preHandlerHookHandler`'s
      // shape exactly, as every other `preHandler` in this codebase does).
      (routeOptions as { preHandler?: unknown }).preHandler = [
        ...existing,
        defaultRateLimitPreHandler,
      ];
    }
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
