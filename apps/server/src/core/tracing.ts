/**
 * apps/server — OpenTelemetry tracing (OBS-02, T92).
 *
 * ── Manual spans, not auto-instrumentation (documented decision) ─────────
 * The task text explicitly allows choosing manual spans over
 * `@opentelemetry/sdk-node` + `@opentelemetry/instrumentation-http`/
 * `-pg` auto-instrumentation when that's simpler/clearer for this scope —
 * chosen here for two concrete reasons: (1) auto-instrumenting `pg`
 * captures SQL query text (and sometimes parameter values) as span
 * attributes by default, which is exactly the kind of payload leak
 * `core/logging.ts`'s `REDACT_PATHS` exists to prevent at the log layer —
 * replicating that same risk at the tracing layer via a library default
 * would be a real regression, not a convenience; (2) auto-instrumenting
 * `http` would double-count REST latency already covered by T91's
 * `MetricsRegistry` (a separate, purpose-built concern) and add span noise
 * for routes this task doesn't need traced (e.g. `/health/*`). Manual
 * spans, built with `@opentelemetry/api` + `@opentelemetry/sdk-trace-base`
 * (no `sdk-node`, no instrumentation packages), let every span's exact
 * attribute set be hand-picked — safe by construction, not by hoping an
 * auto-instrumentation library never captures something sensitive.
 *
 * ── What NEVER becomes a span attribute (reusing `REDACT_PATHS` as the
 *    reference list, per the task's own instruction) ─────────────────────
 * No span anywhere in this codebase sets an attribute containing: a
 * prompt/user-request string, scene/element JSON, an AI provider token/
 * API key, a session/refresh/ws token, a password, or an email address —
 * the exact same field categories `core/logging.ts`'s `REDACT_PATHS`
 * names. Every span below is built from a small, explicit, hand-written
 * attribute object (ids, counts, outcomes, method/route/status) — never a
 * wholesale dump of a request body/response/DB row.
 *
 * ── Context propagation without a registered global ContextManager ──────
 * Spans are chained into the same trace via EXPLICIT parent-`Span`
 * passing (`startChildSpan`'s `parentSpan` param, `Tracer#startSpan`'s own
 * 3rd `context` argument) rather than ambient `context.active()` tracking.
 * This deliberately avoids registering a process-global
 * `AsyncLocalStorage`-based `ContextManager` (an extra dependency and a
 * source of cross-request context leakage risk under Node's async
 * scheduling) — matches this codebase's existing preference for explicit
 * dependency threading (`deps.jobs`/`deps.storage`/T91's `deps.metrics`)
 * over implicit/global state.
 *
 * ── Disabled-by-default exporter (Done-when: "tracing desabilitado ...
 *    sem overhead de exporter real") ──────────────────────────────────────
 * `createTracing`'s default exporter is `InMemorySpanExporter` — spans are
 * always CREATED (cheap, in-process), but never sent over the network
 * unless a caller explicitly injects a real exporter. A real OTLP exporter
 * talking to an actual OTel Collector (e.g.
 * `@opentelemetry/exporter-trace-otlp-http`) is a disclosed, deliberately
 * out-of-scope gap for this sandbox — no real OTel Collector is reachable
 * here (same "real engine, no mocking the protocol — but genuinely
 * unavailable infra stays disclosed" precedent as AD-007's Postgres/MinIO
 * notes); wiring one is real production config, not a code change this
 * task needs to fabricate against nothing to talk to.
 */

import {
  type Attributes,
  ROOT_CONTEXT,
  type Span,
  SpanStatusCode,
  type Tracer,
  trace,
} from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';

export const TRACER_NAME = 'arch-canvas-server';

export interface TracingOverrides {
  /** Injectable span exporter (mirrors `core/logging.ts`'s `LoggerOverrides.stream`) — defaults to `InMemorySpanExporter`, never a real network call. */
  exporter?: SpanExporter;
}

export interface Tracing {
  tracer: Tracer;
  provider: BasicTracerProvider;
  /** The exporter actually wired in — tests read `.getFinishedSpans()` off this when it's an `InMemorySpanExporter` (the default). */
  exporter: SpanExporter;
  shutdown(): Promise<void>;
}

/** Constructing this never touches the network — safe to call unconditionally at server-build time, same as `core/metrics.ts`'s `createMetricsRegistry`. */
export function createTracing(overrides: TracingOverrides = {}): Tracing {
  const exporter = overrides.exporter ?? new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ 'service.name': TRACER_NAME }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const tracer = provider.getTracer(TRACER_NAME);
  return { tracer, provider, exporter, shutdown: () => provider.shutdown() };
}

/** Starts a span, optionally as a child of `parentSpan` (explicit propagation — see module doc comment). */
export function startChildSpan(
  tracer: Tracer,
  name: string,
  attributes: Attributes,
  parentSpan?: Span,
): Span {
  const parentContext = parentSpan ? trace.setSpan(ROOT_CONTEXT, parentSpan) : undefined;
  return tracer.startSpan(name, { attributes }, parentContext);
}

/**
 * Runs `fn` inside a span: starts it (optionally as `parentSpan`'s child),
 * records any thrown error onto the span (`recordException`/`ERROR`
 * status) WITHOUT swallowing it, and always ends the span — success sets
 * `SpanStatusCode.OK`. This is the one reusable primitive every boundary
 * below uses, so every span in this codebase follows the same
 * start/attribute/error/end shape.
 */
export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
  parentSpan?: Span,
): Promise<T> {
  const span = startChildSpan(tracer, name, attributes, parentSpan);
  try {
    const result = await fn(span);
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.recordException(error instanceof Error ? error : String(error));
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    span.end();
  }
}

/**
 * `withSpan`'s degrade-friendly counterpart: when `tracer` is `undefined`
 * (tracing not injected — every existing `CreateAiRunDeps` call site that
 * predates T92), `fn` just runs directly with no span at all — zero
 * overhead, never a crash. Lets a boundary offer tracing as an OPTIONAL
 * dependency (same shape as `deps.jobs`/`deps.metrics` elsewhere in this
 * codebase) without every call site needing to construct a real `Tracing`.
 */
export async function withOptionalSpan<T>(
  tracer: Tracer | undefined,
  name: string,
  attributes: Attributes,
  fn: (span: Span | undefined) => Promise<T>,
  parentSpan?: Span,
): Promise<T> {
  if (!tracer) return fn(undefined);
  return withSpan(tracer, name, attributes, fn, parentSpan);
}

declare module 'fastify' {
  interface FastifyInstance {
    tracing: Tracing;
  }
  interface FastifyRequest {
    /** The REST request's own span (`core/server.ts`'s `onRequest`/`onResponse` hooks) — read by route handlers that want to parent a DB/domain span under it (e.g. `diagram-sync`'s `operations:batch`). */
    otelSpan?: Span;
  }
}
