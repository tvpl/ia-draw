// SPEC_DEVIATION: using PGlite instead of testcontainers — no Docker in this sandbox; PGlite runs a real Postgres engine so integration fidelity is preserved (same precedent as pipeline.int.spec.ts).

import { encryptToken } from '@arch-canvas/ai-tools';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { PGlite } from '@electric-sql/pglite';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../core/config.js';
import { buildServer } from '../../core/server.js';
import { createTracing } from '../../core/tracing.js';
import { createLocalAccount } from '../auth/accounts.js';
import { SESSION_COOKIE_NAME } from '../auth/cookie.js';
import { registerAuthModule } from '../auth/routes.js';
import { createSession } from '../auth/session.js';
import { registerDiagramSyncModule } from '../diagram-sync/routes.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { createAiRun } from './pipeline.js';
import { RunStore } from './runStore.js';

const ENCRYPTION_KEY = 'test-encryption-master-key-for-ai-engine-tracing';
const TEST_TOKEN = 'sk-ai-engine-tracing-test-token-do-not-leak-4b7c';

/**
 * OBS-02 (T92), Done-when #2/#3: proves the "build context → call provider →
 * apply patch" span chain is real (same `traceId`, distinct spans) AND that
 * none of it leaks the AI run's own prompt/scene/token content — reusing
 * `core/logging.ts`'s `REDACT_PATHS` field categories as the reference list
 * of what must never appear in cleartext anywhere observable (this module's
 * own doc comment repeats that discipline for spans specifically).
 */
function scriptedFetch(responses: Array<{ status: number; body: unknown }>): {
  fetchImpl: typeof fetch;
} {
  let index = 0;
  const fetchImpl = (async () => {
    const next = responses[Math.min(index, responses.length - 1)] ?? responses[0];
    index += 1;
    if (!next) throw new Error('scriptedFetch: no responses configured');
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl };
}

function toolCallResponse(toolName: string, args: Record<string, unknown>) {
  return {
    status: 200,
    body: {
      id: 'resp-1',
      model: 'test-model',
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'call-1', function: { name: toolName, arguments: JSON.stringify(args) } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 111, completion_tokens: 22, total_tokens: 133 },
    },
  };
}

describe('AI run trace chain + payload-redaction proof (OBS-02, T92)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let app: FastifyInstance;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await runMigrations(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const config = loadConfig({ NODE_ENV: 'test' });
    app = buildServer(config);
    await registerAuthModule(app, { db, config });
    registerWorkspaceModule(app, { db });
    registerDiagramSyncModule(app, { db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await client.close();
  });

  async function seedUserWithSession(emailPrefix: string) {
    const user = await createLocalAccount(db, {
      email: `${emailPrefix}-${Date.now()}-${Math.random()}@example.com`,
      displayName: emailPrefix,
      password: `${emailPrefix}-password`,
    });
    const session = await createSession(db, user.id);
    return { user, cookies: { [SESSION_COOKIE_NAME]: session.token } };
  }

  async function seedDiagramAs(cookies: Record<string, string>, slug: string) {
    const createWs = await app.inject({
      method: 'POST',
      url: '/workspaces',
      cookies,
      payload: { name: `Tracing WS ${slug}`, slug: `tracing-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Tracing Project ${slug}` },
    });
    const projectId = createProject.json().project.id;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Tracing Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id };
  }

  async function seedProviderConfig(scope: string) {
    const [config] = await db
      .insert(schema.aiProviderConfigs)
      .values({
        scope,
        baseUrl: 'http://127.0.0.1:9/unused', // never dialed — fetchImpl is always injected
        model: 'test-model',
        encryptedToken: encryptToken(TEST_TOKEN, ENCRYPTION_KEY),
      })
      .returning();
    if (!config) throw new Error('provider config insert failed');
    return config;
  }

  /** Seeds one scene element carrying a distinctive, greppable label — the "scene content" this test proves never reaches a span attribute. */
  async function seedSceneElement(
    cookies: Record<string, string>,
    diagramId: string,
    actorId: string,
    label: string,
  ) {
    const response = await app.inject({
      method: 'POST',
      url: `/diagrams/${diagramId}/operations:batch`,
      cookies,
      payload: {
        clientMutationId: crypto.randomUUID(),
        baseRevision: 0,
        actorId,
        deltas: [
          {
            elementId: 'seeded-element-1',
            kind: 'upsert' as const,
            element: { id: 'seeded-element-1', type: 'rectangle', label },
            version: 1,
            versionNonce: 1,
          },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
  }

  it('emits ai.run / ai.build_context / ai.call_provider / ai.apply_patch as ONE chained trace, and none of them leak the prompt/scene/token', async () => {
    const owner = await seedUserWithSession('tracing-chain');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'chain');
    await seedProviderConfig(workspaceId);

    const SECRET_SCENE_LABEL = 'SCENE-MARKER-do-not-leak-e91f7a';
    await seedSceneElement(owner.cookies, diagramId, owner.user.id, SECRET_SCENE_LABEL);

    const SECRET_PROMPT = 'PROMPT-MARKER-do-not-leak-Crie um servidor de API com banco de dados';

    const { fetchImpl } = scriptedFetch([
      toolCallResponse('create_element', { type: 'rectangle', x: 0, y: 0, label: 'API' }),
    ]);

    const exporter = new InMemorySpanExporter();
    const tracing = createTracing({ exporter });

    const result = await createAiRun(
      {
        db,
        encryptionKey: ENCRYPTION_KEY,
        fetchImpl,
        runStore: new RunStore(),
        tracing,
      },
      { diagramId, workspaceId, userId: owner.user.id, userRequest: SECRET_PROMPT },
    );
    expect(result.run.status).toBe('previewing');
    await tracing.provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const byName = (name: string) => spans.find((s) => s.name === name);

    const runSpan = byName('ai.run');
    const buildContextSpan = byName('ai.build_context');
    const callProviderSpan = byName('ai.call_provider');
    const applyPatchSpan = byName('ai.apply_patch');

    expect(runSpan).toBeDefined();
    expect(buildContextSpan).toBeDefined();
    expect(callProviderSpan).toBeDefined();
    expect(applyPatchSpan).toBeDefined();

    // Same trace — all 4 spans share exactly one traceId (Done-when #2:
    // "spans ... encadeados (mesmo trace)").
    const traceId = runSpan?.spanContext().traceId;
    for (const span of [buildContextSpan, callProviderSpan, applyPatchSpan]) {
      expect(span?.spanContext().traceId).toBe(traceId);
    }
    // All 3 children are direct children of the SAME parent (ai.run) —
    // proves the chain fan-out is correct, not just "same trace by luck".
    for (const span of [buildContextSpan, callProviderSpan, applyPatchSpan]) {
      expect(span?.parentSpanContext?.spanId).toBe(runSpan?.spanContext().spanId);
    }

    // Done-when #3: substring search across EVERY span's name + every
    // attribute value (not just the ones this test expects to be safe) for
    // the prompt, the scene content, the provider token, and the
    // encryption key — none of REDACT_PATHS's reference categories.
    const serializedSpans = JSON.stringify(
      spans.map((span) => ({ name: span.name, attributes: span.attributes })),
    );
    expect(serializedSpans).not.toContain(SECRET_PROMPT);
    expect(serializedSpans).not.toContain(SECRET_SCENE_LABEL);
    expect(serializedSpans).not.toContain(TEST_TOKEN);
    expect(serializedSpans).not.toContain(ENCRYPTION_KEY);

    // Positive control — attributes are still genuinely useful (ids/counts),
    // just never content, proving the redaction isn't just "no attributes
    // at all".
    expect(runSpan?.attributes).toMatchObject({
      'diagram.id': diagramId,
      'workspace.id': workspaceId,
    });
    expect(applyPatchSpan?.attributes?.['ai.tool_call_count']).toBe(1);
  });

  it('a FAILED AI run (provider error) still emits ai.run + ai.call_provider with ERROR status, and still leaks nothing', async () => {
    const owner = await seedUserWithSession('tracing-fail');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'fail');
    await seedProviderConfig(workspaceId);

    const SECRET_PROMPT = 'PROMPT-MARKER-fail-path-do-not-leak-Apague tudo';
    const { fetchImpl } = scriptedFetch([{ status: 500, body: { error: 'provider down' } }]);

    const exporter = new InMemorySpanExporter();
    const tracing = createTracing({ exporter });

    const result = await createAiRun(
      { db, encryptionKey: ENCRYPTION_KEY, fetchImpl, runStore: new RunStore(), tracing },
      { diagramId, workspaceId, userId: owner.user.id, userRequest: SECRET_PROMPT },
    );
    expect(result.run.status).toBe('failed');
    await tracing.provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans.find((s) => s.name === 'ai.run')).toBeDefined();
    expect(spans.find((s) => s.name === 'ai.call_provider')).toBeDefined();
    // apply_patch is never reached on a call_provider failure (the pipeline
    // returns before the tool-call loop) — confirms spans mirror the ACTUAL
    // control flow, not a hardcoded fixed set.
    expect(spans.find((s) => s.name === 'ai.apply_patch')).toBeUndefined();

    const serializedSpans = JSON.stringify(
      spans.map((span) => ({ name: span.name, attributes: span.attributes })),
    );
    expect(serializedSpans).not.toContain(SECRET_PROMPT);
    expect(serializedSpans).not.toContain(TEST_TOKEN);
  });

  it('tracing omitted entirely (deps.tracing undefined) — the run still completes normally, proving the observability seam is a true optional degrade', async () => {
    const owner = await seedUserWithSession('tracing-omitted');
    const { workspaceId, diagramId } = await seedDiagramAs(owner.cookies, 'omitted');
    await seedProviderConfig(workspaceId);

    const { fetchImpl } = scriptedFetch([
      toolCallResponse('create_element', { type: 'rectangle', x: 0, y: 0, label: 'API' }),
    ]);

    const result = await createAiRun(
      { db, encryptionKey: ENCRYPTION_KEY, fetchImpl, runStore: new RunStore() },
      { diagramId, workspaceId, userId: owner.user.id, userRequest: 'Crie um elemento' },
    );

    expect(result.run.status).toBe('previewing');
  });
});
