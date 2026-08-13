import { SpanStatusCode } from '@opentelemetry/api';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';
import { createTracing, startChildSpan, withOptionalSpan, withSpan } from './tracing.js';

describe('core/tracing (OBS-02, T92)', () => {
  it('createTracing() defaults to an InMemorySpanExporter — never a real network exporter, zero export overhead until a caller injects one', () => {
    const tracing = createTracing();
    expect(tracing.exporter).toBeInstanceOf(InMemorySpanExporter);
  });

  it('an injected exporter is the exact instance createTracing wires into the provider (mirrors loggerOverrides.stream)', async () => {
    const exporter = new InMemorySpanExporter();
    const tracing = createTracing({ exporter });
    expect(tracing.exporter).toBe(exporter);

    const span = tracing.tracer.startSpan('manual-span');
    span.end();
    await tracing.provider.forceFlush();

    expect(exporter.getFinishedSpans()).toHaveLength(1);
    expect(exporter.getFinishedSpans()[0]?.name).toBe('manual-span');
  });

  it('withSpan records attributes, sets OK status on success, and always ends the span', async () => {
    const exporter = new InMemorySpanExporter();
    const tracing = createTracing({ exporter });

    const result = await withSpan(tracing.tracer, 'op.succeeds', { 'op.count': 3 }, async () => 42);
    await tracing.provider.forceFlush();

    expect(result).toBe(42);
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.name).toBe('op.succeeds');
    expect(spans[0]?.attributes).toEqual({ 'op.count': 3 });
    expect(spans[0]?.status.code).toBe(SpanStatusCode.OK);
    expect(spans[0]?.endTime).toBeDefined();
  });

  it('withSpan records the exception and sets ERROR status, but never swallows the throw', async () => {
    const exporter = new InMemorySpanExporter();
    const tracing = createTracing({ exporter });

    await expect(
      withSpan(tracing.tracer, 'op.fails', {}, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await tracing.provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0]?.status.message).toBe('boom');
    expect(spans[0]?.events.some((event) => event.name === 'exception')).toBe(true);
  });

  it('startChildSpan chains a child under its parent — same traceId, distinct spanId, correct parent link', async () => {
    const exporter = new InMemorySpanExporter();
    const tracing = createTracing({ exporter });

    const parent = startChildSpan(tracing.tracer, 'parent', {});
    const child = startChildSpan(tracing.tracer, 'child', {}, parent);
    child.end();
    parent.end();
    await tracing.provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const parentSpan = spans.find((s) => s.name === 'parent');
    const childSpan = spans.find((s) => s.name === 'child');
    expect(parentSpan).toBeDefined();
    expect(childSpan).toBeDefined();
    expect(childSpan?.spanContext().traceId).toBe(parentSpan?.spanContext().traceId);
    expect(childSpan?.parentSpanContext?.spanId).toBe(parentSpan?.spanContext().spanId);
  });

  it('two root spans (no parent passed) belong to different traces', async () => {
    const exporter = new InMemorySpanExporter();
    const tracing = createTracing({ exporter });

    const a = startChildSpan(tracing.tracer, 'a', {});
    const b = startChildSpan(tracing.tracer, 'b', {});
    a.end();
    b.end();
    await tracing.provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const spanA = spans.find((s) => s.name === 'a');
    const spanB = spans.find((s) => s.name === 'b');
    expect(spanA?.spanContext().traceId).not.toBe(spanB?.spanContext().traceId);
  });

  it('withOptionalSpan runs fn directly with no span and no error when tracer is undefined (the degrade every optional observability seam in this codebase uses)', async () => {
    const result = await withOptionalSpan(undefined, 'never-created', {}, async (span) => {
      expect(span).toBeUndefined();
      return 'ok';
    });
    expect(result).toBe('ok');
  });

  it('withOptionalSpan behaves exactly like withSpan when a tracer IS supplied', async () => {
    const exporter = new InMemorySpanExporter();
    const tracing = createTracing({ exporter });

    await withOptionalSpan(tracing.tracer, 'present', { x: 1 }, async (span) => {
      expect(span).toBeDefined();
    });
    await tracing.provider.forceFlush();

    expect(exporter.getFinishedSpans().map((s) => s.name)).toContain('present');
  });
});
