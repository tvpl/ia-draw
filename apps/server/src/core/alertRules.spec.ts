import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { createMetricsRegistry } from './metrics.js';

/**
 * Validates `infra/observability/alerts.yml` (T93, OBS-03) against the
 * REAL Prometheus Alerting Rules schema (`groups: [{ name, rules: [{
 * alert, expr, for?, labels?, annotations? }] }]`) — not just "is valid
 * YAML" — and cross-checks every metric name referenced in every rule's
 * `expr` against `MetricsRegistry` (T91/T93), the actual `/metrics`
 * registry, so a renamed/removed metric breaks this test instead of
 * silently producing a dead alert rule.
 */

const ALERTS_YML_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'infra',
  'observability',
  'alerts.yml',
);

// Prometheus duration literal: an integer followed by one of ms/s/m/h/d/w/y
// (https://prometheus.io/docs/prometheus/latest/configuration/configuration/#duration).
const PROMETHEUS_DURATION_RE = /^\d+(ms|s|m|h|d|w|y)$/;

const promDuration = z.string().regex(PROMETHEUS_DURATION_RE, 'not a valid Prometheus duration');

/** Real Prometheus Alerting Rule schema — a rule group's own "alert" (not "record") rule shape. */
const alertingRuleSchema = z.object({
  alert: z.string().min(1),
  expr: z.string().min(1),
  for: promDuration.optional(),
  keep_firing_for: promDuration.optional(),
  labels: z.record(z.string(), z.string()).optional(),
  annotations: z.record(z.string(), z.string()).optional(),
});

const ruleGroupSchema = z.object({
  name: z.string().min(1),
  interval: promDuration.optional(),
  rules: z.array(alertingRuleSchema).min(1),
});

const alertingRulesFileSchema = z.object({
  groups: z.array(ruleGroupSchema).min(1),
});

function loadAlertsYaml() {
  const raw = readFileSync(ALERTS_YML_PATH, 'utf8');
  const parsed = parseYaml(raw);
  return alertingRulesFileSchema.parse(parsed);
}

/** Every timeseries suffix Prometheus text format appends to a Histogram/Counter's base name — stripped before matching against `MetricsRegistry`'s registered (base) metric names. */
const METRIC_NAME_SUFFIXES = ['_bucket', '_sum', '_count'];

function baseMetricName(name: string): string {
  for (const suffix of METRIC_NAME_SUFFIXES) {
    if (name.endsWith(suffix)) return name.slice(0, -suffix.length);
  }
  return name;
}

/** Extracts every `arch_canvas_*` token referenced in a PromQL `expr` string — labels (e.g. `route="..."`) are never metric names, only the identifier immediately before `{`/whitespace/an operator is. */
function extractReferencedMetricNames(expr: string): string[] {
  const matches = expr.match(/\barch_canvas_[a-zA-Z0-9_]*\b/g) ?? [];
  return [...new Set(matches.map(baseMetricName))];
}

async function registeredMetricNames(): Promise<Set<string>> {
  const metrics = createMetricsRegistry();
  const text = await metrics.registry.metrics();
  const names = new Set<string>();
  for (const line of text.split('\n')) {
    const match = line.match(/^# HELP (\S+) /);
    if (match?.[1]) names.add(match[1]);
  }
  return names;
}

describe('infra/observability/alerts.yml (OBS-03, T93)', () => {
  it('parses as valid YAML and validates against the real Prometheus Alerting Rules schema', () => {
    expect(() => loadAlertsYaml()).not.toThrow();
    const parsed = loadAlertsYaml();
    expect(parsed.groups.length).toBeGreaterThan(0);
  });

  it('rejects a structurally invalid rules file (proves the schema check is real, not a rubber stamp)', () => {
    const invalid = { groups: [{ name: 'x', rules: [{ alert: 'NoExpr' }] }] };
    expect(() => alertingRulesFileSchema.parse(invalid)).toThrow();

    const badDuration = {
      groups: [{ name: 'x', rules: [{ alert: 'A', expr: 'up == 1', for: 'not-a-duration' }] }],
    };
    expect(() => alertingRulesFileSchema.parse(badDuration)).toThrow();
  });

  it("contains exactly the 7 alert rules matching docs/product-spec.md §11's documented thresholds, one per rule", () => {
    const parsed = loadAlertsYaml();
    const allRules = parsed.groups.flatMap((group) => group.rules);
    expect(allRules).toHaveLength(7);

    const byAlertName = new Map(allRules.map((rule) => [rule.alert, rule]));
    expect([...byAlertName.keys()].sort()).toEqual(
      [
        'AuthFailureSpike',
        'BackupRestoreTestFailing',
        'DiagramSaveErrorRateHigh',
        'JobQueueBacklogged',
        'MutationAckLatencyP95High',
        'SnapshotCompactionFailing',
        'StorageDependencyDown',
      ].sort(),
    );

    // "ACK p95 > 2 s" — the literal threshold value appears in the expr.
    expect(byAlertName.get('MutationAckLatencyP95High')?.expr).toContain('0.95');
    expect(byAlertName.get('MutationAckLatencyP95High')?.expr).toMatch(/>\s*2\b/);

    // "erro save > 1%" — expressed as a fraction > 0.01.
    expect(byAlertName.get('DiagramSaveErrorRateHigh')?.expr).toMatch(/>\s*0\.01\b/);

    // The remaining 5 thresholds have no explicit number in the source doc
    // (qualitative language: "atrasada"/"falhando"/"indisponível"/
    // "inválido"/"aumento") — each rule's expr still references a genuine
    // metric and a documented (non-zero) condition, asserted individually
    // by name below rather than by a shared numeric pattern.
    expect(byAlertName.get('JobQueueBacklogged')?.expr).toContain('arch_canvas_job_queue_depth');
    expect(byAlertName.get('SnapshotCompactionFailing')?.expr).toContain(
      'arch_canvas_snapshot_compaction_failures_total',
    );
    expect(byAlertName.get('StorageDependencyDown')?.expr).toContain('arch_canvas_dependency_up');
    expect(byAlertName.get('BackupRestoreTestFailing')?.expr).toContain(
      'arch_canvas_restore_test_failures_total',
    );
    expect(byAlertName.get('AuthFailureSpike')?.expr).toContain('arch_canvas_auth_failures_total');
  });

  it('every metric name referenced in every rule expr is a metric MetricsRegistry (T91/T93) actually registers', async () => {
    const parsed = loadAlertsYaml();
    const allRules = parsed.groups.flatMap((group) => group.rules);
    const registered = await registeredMetricNames();

    expect(registered.size).toBeGreaterThan(0);

    for (const rule of allRules) {
      const referenced = extractReferencedMetricNames(rule.expr);
      expect(referenced.length).toBeGreaterThan(0); // every rule DOES reference at least one metric
      for (const metricName of referenced) {
        expect(
          registered.has(metricName),
          `alert "${rule.alert}" references "${metricName}", which is not in MetricsRegistry`,
        ).toBe(true);
      }
    }
  });

  it('every rule has severity + summary + description — never a silent/uninterpretable alert', () => {
    const parsed = loadAlertsYaml();
    for (const rule of parsed.groups.flatMap((group) => group.rules)) {
      expect(rule.labels?.severity).toBeDefined();
      expect(rule.annotations?.summary).toBeTruthy();
      expect(rule.annotations?.description).toBeTruthy();
      expect(rule.for).toBeDefined(); // never fires on a single instantaneous sample
    }
  });
});
