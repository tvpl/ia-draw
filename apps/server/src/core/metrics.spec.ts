import { describe, expect, it } from 'vitest';
import {
  createMetricsRegistry,
  ESTIMATED_COST_PER_1K_TOKENS_USD,
  METRIC_PREFIX,
} from './metrics.js';

describe('MetricsRegistry (OBS-01, T91)', () => {
  it('produces valid Prometheus text-exposition format with every documented series present, even at value 0 on a fresh registry', async () => {
    const metrics = createMetricsRegistry();
    const output = await metrics.registry.metrics();

    for (const name of [
      'http_request_duration_seconds',
      'http_errors_total',
      'mutation_ack_duration_seconds',
      'job_queue_depth',
      'snapshot_compaction_duration_seconds',
      'ai_run_duration_seconds',
      'ai_run_tokens_total',
      'ai_run_estimated_cost_usd_total',
      'export_duration_seconds',
    ]) {
      expect(output).toContain(`${METRIC_PREFIX}${name}`);
    }

    // Prometheus text format sanity: every non-comment, non-empty line is
    // `metric_name{labels} value` or `metric_name value` — not a deep
    // schema validation (that's T93's job cross-checking against this
    // registry), just confirming this is genuinely parseable exposition
    // text, not an arbitrary string.
    const dataLines = output.split('\n').filter((line) => line.length > 0 && !line.startsWith('#'));
    expect(dataLines.length).toBeGreaterThan(0);
    for (const line of dataLines) {
      expect(line).toMatch(/^[a-zA-Z_:][a-zA-Z0-9_:]*(\{[^}]*\})?\s+\S+$/);
    }
  });

  it('observeHttpRequest increments both the latency histogram and, only for 5xx, the error counter', async () => {
    const metrics = createMetricsRegistry();
    metrics.observeHttpRequest('GET', '/diagrams/:id/bootstrap', 200, 0.05);
    metrics.observeHttpRequest('POST', '/diagrams/:id/exports', 503, 0.2);

    const output = await metrics.registry.metrics();
    expect(output).toMatch(
      /arch_canvas_http_request_duration_seconds_count\{method="GET",route="\/diagrams\/:id\/bootstrap",status_code="200"\} 1/,
    );
    expect(output).toMatch(
      /arch_canvas_http_errors_total\{method="POST",route="\/diagrams\/:id\/exports",status_code="503"\} 1/,
    );
    // The 200 response must never increment the error counter.
    expect(output).not.toMatch(/status_code="200"[^\n]*\n[^\n]*http_errors_total/);
  });

  it('observeMutationAck records into the SAME histogram for both transports, distinguished only by the transport label', async () => {
    const metrics = createMetricsRegistry();
    metrics.observeMutationAck('rest', 0.01);
    metrics.observeMutationAck('ws', 0.02);

    const output = await metrics.registry.metrics();
    expect(output).toMatch(/arch_canvas_mutation_ack_duration_seconds_count\{transport="rest"\} 1/);
    expect(output).toMatch(/arch_canvas_mutation_ack_duration_seconds_count\{transport="ws"\} 1/);
  });

  it('observeAiRun reads token counts straight from usage and increments the estimated-cost counter proportionally', async () => {
    const metrics = createMetricsRegistry();
    metrics.observeAiRun('previewing', 1.5, {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });

    const output = await metrics.registry.metrics();
    expect(output).toMatch(/arch_canvas_ai_run_tokens_total\{kind="prompt"\} 100/);
    expect(output).toMatch(/arch_canvas_ai_run_tokens_total\{kind="completion"\} 50/);
    const expectedCost = (150 / 1000) * ESTIMATED_COST_PER_1K_TOKENS_USD;
    expect(output).toMatch(
      new RegExp(`arch_canvas_ai_run_estimated_cost_usd_total ${expectedCost}`),
    );
  });

  it('observeAiRun with empty usage (a failed run before any provider response) records duration but no token/cost increment', async () => {
    const metrics = createMetricsRegistry();
    metrics.observeAiRun('failed', 0.3, {});

    const output = await metrics.registry.metrics();
    expect(output).toMatch(/arch_canvas_ai_run_duration_seconds_count\{outcome="failed"\} 1/);
    expect(output).not.toMatch(/arch_canvas_ai_run_tokens_total\{kind="prompt"\} [1-9]/);
    expect(output).toMatch(/arch_canvas_ai_run_estimated_cost_usd_total 0/);
  });

  it('job_queue_depth stays 0 with no jobs source configured, and reflects a live pg-boss sample once one is set', async () => {
    const metrics = createMetricsRegistry();
    const before = await metrics.registry.metrics();
    // The HELP/TYPE comment lines exist (the series is documented as
    // present per this file's first test), but no labeled data line does —
    // nothing has ever called `.set()` for any `queue` label yet.
    expect(before).not.toMatch(/arch_canvas_job_queue_depth\{queue="/);

    const fakeJobs = {
      getQueueStats: async (name: string) => [
        {
          name,
          deferredCount: 1,
          queuedCount: 0,
          readyCount: 2,
          activeCount: 3,
          failedCount: 0,
          totalCount: 6,
          capturedOn: new Date(),
        },
      ],
      // biome-ignore lint/suspicious/noExplicitAny: minimal fake satisfying only the one method MetricsRegistry calls
    } as any;

    metrics.setJobQueueDepthSource(fakeJobs, ['compact-diagram']);
    const after = await metrics.registry.metrics();
    // 1 (deferred) + 2 (ready) + 3 (active) = 6.
    expect(after).toMatch(/arch_canvas_job_queue_depth\{queue="compact-diagram"\} 6/);
  });

  it('job_queue_depth collect() never throws when a configured queue does not exist yet — it leaves the gauge as-is instead of failing the whole scrape', async () => {
    const metrics = createMetricsRegistry();
    const throwingJobs = {
      getQueueStats: async () => {
        throw new Error('queue not found');
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal fake satisfying only the one method MetricsRegistry calls
    } as any;

    metrics.setJobQueueDepthSource(throwingJobs, ['never-registered']);
    await expect(metrics.registry.metrics()).resolves.toBeTypeOf('string');
  });
});
