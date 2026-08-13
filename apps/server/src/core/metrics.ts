/**
 * apps/server — Prometheus metrics registry (OBS-01, T91).
 *
 * Researched `prom-client`'s CURRENT installed API (`prom-client@15.1.3`,
 * `node_modules/.pnpm/prom-client@15.1.3/node_modules/prom-client/index.d.ts`)
 * directly before writing any code (Knowledge Verification Chain):
 * `Registry`/`Counter`/`Gauge`/`Histogram` are plain classes constructed
 * with a `{ name, help, labelNames?, registers? }` configuration object;
 * `Registry#metrics()` returns `Promise<string>` (the Prometheus text
 * exposition format) and awaits every metric's own async `collect()`
 * callback first — `Gauge`'s optional `collect` config
 * (`(this: Gauge) => void | Promise<void>`) is exactly the mechanism this
 * module uses to sample pg-boss's queue depth LIVE on every scrape, rather
 * than via a bespoke poller (mirrors this codebase's existing preference
 * for the library's own native mechanism over a hand-rolled one, e.g.
 * T90's `PgBoss#schedule` research).
 *
 * ── Disclosure (mirrors `/health/*`'s own disclosure style) ─────────────
 * `GET /metrics` is registered with NO session/auth requirement — the
 * standard Prometheus scrape convention (a scrape target is not an
 * authenticated end-user client). This endpoint MUST be restricted by
 * network/firewall policy in a real deployment (e.g. only reachable from
 * the cluster's own Prometheus scrape address), exactly the same
 * production-hardening caveat `core/server.ts`'s `/health/live`/`/health/ready`
 * already carry.
 *
 * ── Estimated AI cost (disclosed scope note) ─────────────────────────────
 * `aiRunEstimatedCostUsdTotal` uses a single flat, DOCUMENTED-AS-ROUGH
 * per-1k-token rate (`ESTIMATED_COST_PER_1K_TOKENS_USD`) rather than a real
 * provider billing API — AIC-01..03 already establish that AI providers in
 * this system are arbitrary operator-configured/self-hosted OpenAI-
 * compatible endpoints (not a single metered vendor this codebase could
 * query for real pricing), so an exact cost figure is not obtainable here.
 * This mirrors AIC-04/PRS-01's own "disclosed, not silently approximated
 * as exact" precedent.
 */

import type { Registry as PromRegistry } from 'prom-client';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import type { JobQueue } from '../modules/jobs/index.js';

/** Every metric name in this registry is prefixed with this, per Prometheus naming convention. */
export const METRIC_PREFIX = 'arch_canvas_';

/** Documented rough estimate — see this module's own doc comment above. */
export const ESTIMATED_COST_PER_1K_TOKENS_USD = 0.01;

export type MutationTransport = 'rest' | 'ws';
export type AiTokenKind = 'prompt' | 'completion';

interface JobQueueDepthSource {
  jobs: JobQueue;
  queueNames: readonly string[];
}

/**
 * One process-wide (per `FastifyInstance`) registry of every metric OBS-01
 * documents. Constructing this never touches the network/DB — safe to
 * create unconditionally at server-build time, same as `core/logging.ts`'s
 * `buildLoggerOptions`.
 */
export class MetricsRegistry {
  readonly registry: PromRegistry;

  /** REST latency, one observation per response (`core/server.ts`'s `onResponse` hook). */
  readonly httpRequestDuration: Histogram<'method' | 'route' | 'status_code'>;
  /** REST server-error count (status >= 500) — a separate signal from latency, per OBS-01's own "latência+contagem de erro" wording. */
  readonly httpErrorsTotal: Counter<'method' | 'route' | 'status_code'>;

  /** Mutation ACK latency — the SAME histogram observed from BOTH transports (REST `operations:batch` AND WS `mutation`), per F4's "WS is just a second transport" invariant. */
  readonly mutationAckDuration: Histogram<'transport'>;

  /** Pending+active job count per pg-boss queue — sampled live via `collect()` on every scrape (see module doc comment); 0/absent until `setJobQueueDepthSource` is called (e.g. no `deps.jobs` configured — a legitimate degrade, mirrors every other optional-`jobs` seam in this codebase). */
  readonly jobQueueDepth: Gauge<'queue'>;

  /** Snapshot/compaction wall-clock duration (`snapshot/compaction.ts`'s `compactDiagram`). */
  readonly snapshotCompactionDuration: Histogram<'kind'>;

  /** AI run wall-clock duration, end to end (`ai-engine/pipeline.ts`'s `createAiRun`). */
  readonly aiRunDuration: Histogram<'outcome'>;
  /** Token counts read straight from the persisted `ai_runs.usage_json` (F2c) — never re-derived. */
  readonly aiRunTokensTotal: Counter<'kind'>;
  /** See this module's own doc comment on the estimate's honesty scope. */
  readonly aiRunEstimatedCostUsdTotal: Counter;

  /** Export generation duration, per format (`export/routes.ts`'s `POST /diagrams/:id/exports`). */
  readonly exportDuration: Histogram<'format'>;

  #jobsSource: JobQueueDepthSource | undefined;

  constructor() {
    this.registry = new Registry();

    this.httpRequestDuration = new Histogram({
      name: `${METRIC_PREFIX}http_request_duration_seconds`,
      help: 'REST request latency in seconds, by method/route/status_code.',
      labelNames: ['method', 'route', 'status_code'] as const,
      registers: [this.registry],
    });

    this.httpErrorsTotal = new Counter({
      name: `${METRIC_PREFIX}http_errors_total`,
      help: 'Count of REST responses with a 5xx status code, by method/route/status_code.',
      labelNames: ['method', 'route', 'status_code'] as const,
      registers: [this.registry],
    });

    this.mutationAckDuration = new Histogram({
      name: `${METRIC_PREFIX}mutation_ack_duration_seconds`,
      help: 'Time to acknowledge a diagram mutation batch, by transport (rest|ws).',
      labelNames: ['transport'] as const,
      registers: [this.registry],
    });

    this.jobQueueDepth = new Gauge({
      name: `${METRIC_PREFIX}job_queue_depth`,
      help: 'Pending+active+deferred job count per pg-boss queue, sampled live on every scrape.',
      labelNames: ['queue'] as const,
      registers: [this.registry],
      collect: async () => {
        const source = this.#jobsSource;
        if (!source) return;
        for (const queueName of source.queueNames) {
          try {
            const stats = await source.jobs.getQueueStats(queueName);
            const snapshot = stats[0];
            const depth = snapshot
              ? snapshot.readyCount + snapshot.activeCount + snapshot.deferredCount
              : 0;
            this.jobQueueDepth.set({ queue: queueName }, depth);
          } catch {
            // Queue not created yet (e.g. never enqueued once) or a
            // transient read error — leave whatever value was last set
            // rather than fail the whole scrape over one queue.
          }
        }
      },
    });

    this.snapshotCompactionDuration = new Histogram({
      name: `${METRIC_PREFIX}snapshot_compaction_duration_seconds`,
      help: 'Wall-clock time to compact a diagram op-log into a fresh snapshot.',
      labelNames: ['kind'] as const,
      registers: [this.registry],
    });

    this.aiRunDuration = new Histogram({
      name: `${METRIC_PREFIX}ai_run_duration_seconds`,
      help: 'End-to-end AI run duration in seconds, by outcome (previewing|failed).',
      labelNames: ['outcome'] as const,
      registers: [this.registry],
      buckets: [0.5, 1, 2, 5, 10, 30, 60],
    });

    this.aiRunTokensTotal = new Counter({
      name: `${METRIC_PREFIX}ai_run_tokens_total`,
      help: 'Token count reported in ai_runs.usage_json, by kind (prompt|completion).',
      labelNames: ['kind'] as const,
      registers: [this.registry],
    });

    this.aiRunEstimatedCostUsdTotal = new Counter({
      name: `${METRIC_PREFIX}ai_run_estimated_cost_usd_total`,
      help: `Rough estimated USD cost of AI runs, at a flat $${ESTIMATED_COST_PER_1K_TOKENS_USD}/1k tokens (disclosed estimate, not real provider billing — see module doc comment).`,
      registers: [this.registry],
    });

    this.exportDuration = new Histogram({
      name: `${METRIC_PREFIX}export_duration_seconds`,
      help: 'Wall-clock time to generate one export bundle, by format.',
      labelNames: ['format'] as const,
      registers: [this.registry],
    });
  }

  /** Wires the live pg-boss queue-depth sampler on (called once at boot when `deps.jobs` is configured — see `registerModules.ts`). */
  setJobQueueDepthSource(jobs: JobQueue, queueNames: readonly string[]): void {
    this.#jobsSource = { jobs, queueNames };
  }

  /** Records one REST request's latency + (conditionally) a server-error increment — `core/server.ts`'s `onResponse` hook. */
  observeHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationSeconds: number,
  ): void {
    const labels = { method, route, status_code: String(statusCode) };
    this.httpRequestDuration.observe(labels, durationSeconds);
    if (statusCode >= 500) this.httpErrorsTotal.inc(labels);
  }

  /** Records one mutation batch's ACK latency, from either transport. */
  observeMutationAck(transport: MutationTransport, durationSeconds: number): void {
    this.mutationAckDuration.observe({ transport }, durationSeconds);
  }

  /** Records one compaction run's duration. `kind` defaults to `'auto'` (the only kind `compactDiagram` currently produces). */
  observeSnapshotCompaction(durationSeconds: number, kind = 'auto'): void {
    this.snapshotCompactionDuration.observe({ kind }, durationSeconds);
  }

  /**
   * Records one completed AI run: duration + token counts read straight
   * from `usage_json` (never re-derived) + the resulting estimated-cost
   * increment. `usage` mirrors `pipeline.ts`'s own `usageJson` shape —
   * omitted fields (e.g. a provider that reported no usage at all) simply
   * contribute 0.
   */
  observeAiRun(
    outcome: 'previewing' | 'failed',
    durationSeconds: number,
    usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number },
  ): void {
    this.aiRunDuration.observe({ outcome }, durationSeconds);
    const promptTokens = usage.promptTokens ?? 0;
    const completionTokens = usage.completionTokens ?? 0;
    const totalTokens = usage.totalTokens ?? promptTokens + completionTokens;
    if (promptTokens > 0) this.aiRunTokensTotal.inc({ kind: 'prompt' }, promptTokens);
    if (completionTokens > 0) this.aiRunTokensTotal.inc({ kind: 'completion' }, completionTokens);
    if (totalTokens > 0) {
      this.aiRunEstimatedCostUsdTotal.inc((totalTokens / 1000) * ESTIMATED_COST_PER_1K_TOKENS_USD);
    }
  }

  /** Records one export-generation call's duration, by format. */
  observeExport(format: string, durationSeconds: number): void {
    this.exportDuration.observe({ format }, durationSeconds);
  }
}

export function createMetricsRegistry(): MetricsRegistry {
  return new MetricsRegistry();
}

declare module 'fastify' {
  interface FastifyInstance {
    metrics: MetricsRegistry;
  }
}
