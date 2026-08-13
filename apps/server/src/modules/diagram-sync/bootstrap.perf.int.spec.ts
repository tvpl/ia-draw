// SPEC_DEVIATION / PERF-01 disclosure (read before trusting these numbers): this
// benchmark runs against PGlite (a real Postgres engine compiled to WASM, AD-007) inside
// this single sandbox process — one CPU-bound Node process, no network hop, no real disk
// fsync latency, no concurrent tenants, no connection pool contention. It is a PROXY that
// keeps the persistence/query code path and Postgres semantics real (constraints, real
// SQL, real transactions), NOT a substitute for genuine production-infrastructure load
// testing (real Postgres over a real network, realistic concurrency, real disk I/O). A
// pass here is evidence the code path is not pathologically slow under a faithful-but-
// idealized proxy; it is not a production SLO guarantee. Same honesty-over-theater
// discipline as T90's restore-test job, T91's `/metrics` estimated-cost disclosure, and
// T93's "no real Prometheus server in this sandbox" note — see those files' own header
// comments for the same tone.
//
// Documented targets (docs/product-spec.md §11, SLO inicial, quoted verbatim):
// "p95 ACK < 1 s na LAN com lote normal; bootstrap p95 < 3 s para diagrama de 5 mil
// elementos". This file measures both, at 1k/5k/10k elements, and asserts against those
// exact thresholds where the source doc actually specifies a scene size (bootstrap @ 5k).
// 1k is asserted against the same 3s ceiling as a strictly-easier sanity check (fewer
// elements to fold than the documented 5k case). 10k has no documented target in the
// source doc — its numbers are measured and logged, not asserted against an invented
// threshold, so a slower-than-5k result at 10k is expected and not a failure.

import { randomUUID } from 'node:crypto';
import * as schema from '@arch-canvas/database';
import { MIGRATIONS_FOLDER } from '@arch-canvas/database';
import { MAX_OPERATION_ELEMENTS } from '@arch-canvas/diagram-domain';
import type { ElementDelta, SceneElement } from '@arch-canvas/editor-adapter';
import { generateScene } from '@arch-canvas/test-fixtures';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as runMigrations } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../core/config.js';
import { buildServer } from '../../core/server.js';
import { createLocalAccount } from '../auth/accounts.js';
import { SESSION_COOKIE_NAME } from '../auth/cookie.js';
import { registerAuthModule } from '../auth/routes.js';
import { createSession } from '../auth/session.js';
import { registerWorkspaceModule } from '../workspace/index.js';
import { appendOperation } from './operations.js';
import { registerDiagramSyncModule } from './routes.js';

/** Documented SLO targets, quoted verbatim from docs/product-spec.md §11. */
const BOOTSTRAP_P95_TARGET_MS = 3_000;
const BOOTSTRAP_TARGET_ELEMENT_COUNT = 5_000;
const ACK_P95_TARGET_MS = 1_000;
const TYPICAL_BATCH_SIZE = 30;

const SCENE_SIZES = [1_000, 5_000, 10_000] as const;
/** Small sample count deliberately chosen to keep this proxy benchmark's own runtime
 * bounded (each sample is a real end-to-end HTTP request against real PGlite) — enough
 * to compute a meaningful p95 without turning this into a multi-minute suite. */
const SAMPLE_COUNT = 7;

function percentile(sortedAscMs: readonly number[], p: number): number {
  const index = Math.min(
    sortedAscMs.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedAscMs.length) - 1),
  );
  // biome-ignore lint/style/noNonNullAssertion: index is always in range by construction
  return sortedAscMs[index]!;
}

async function timeMs<T>(fn: () => Promise<T>): Promise<number> {
  const startedAt = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}

describe('performance benchmark: bootstrap + operations:batch ACK at scale (T94, PERF-01)', () => {
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
      payload: { name: `Perf WS ${slug}`, slug: `perf-ws-${slug}-${Date.now()}` },
    });
    const workspaceId = createWs.json().workspace.id;

    const createProject = await app.inject({
      method: 'POST',
      url: '/projects',
      cookies,
      payload: { workspaceId, name: `Perf Project ${slug}` },
    });
    const projectId = createProject.json().project.id;

    const createDiagram = await app.inject({
      method: 'POST',
      url: '/diagrams',
      cookies,
      payload: { projectId, title: `Perf Diagram ${slug}` },
    });
    return { workspaceId, diagramId: createDiagram.json().diagram.id };
  }

  /**
   * Persists `elementCount` generated elements onto `diagramId`, chunked at
   * `MAX_OPERATION_ELEMENTS` per operation row — mirroring how a real scene this large
   * would actually have accumulated over many real `operations:batch` calls, not one
   * artificially oversized row. Goes through the SAME `appendOperation` the real REST
   * route calls (never a bespoke bulk-insert shortcut) — the only thing skipped is the
   * HTTP layer itself, since seeding time is setup, not part of what this file measures.
   */
  async function seedLargeScene(
    diagramId: string,
    actorId: string,
    elementCount: number,
    seed: number,
  ) {
    const elements = generateScene(elementCount, seed);
    for (let offset = 0; offset < elements.length; offset += MAX_OPERATION_ELEMENTS) {
      const chunk = elements.slice(offset, offset + MAX_OPERATION_ELEMENTS);
      const deltas: ElementDelta[] = chunk.map((element) => ({
        elementId: element.id,
        kind: 'upsert',
        element: element as unknown as SceneElement,
        version: 1,
        versionNonce: (element.versionNonce as number) ?? 1,
      }));
      await appendOperation(db, diagramId, actorId, {
        clientMutationId: randomUUID(),
        baseRevision: 0,
        actorId,
        deltas,
      });
    }
  }

  /** A "typical" mutation batch (design.md/T94's own example: 20-50 deltas) — new,
   * previously-unseen elements, mimicking a user drawing a fresh cluster of shapes. */
  function typicalBatchEnvelope(actorId: string, sampleSeed: number) {
    const elements = generateScene(TYPICAL_BATCH_SIZE, sampleSeed);
    const deltas: ElementDelta[] = elements.map((element, i) => ({
      elementId: `${element.id}-typical-${sampleSeed}-${i}`,
      kind: 'upsert' as const,
      element: {
        ...element,
        id: `${element.id}-typical-${sampleSeed}-${i}`,
      } as unknown as SceneElement,
      version: 1,
      versionNonce: (element.versionNonce as number) ?? 1,
    }));
    return {
      clientMutationId: randomUUID(),
      baseRevision: 0,
      actorId,
      deltas,
    };
  }

  describe.each(SCENE_SIZES)('%d-element scene', (elementCount) => {
    it(`bootstrap and operations:batch ACK latency at ${elementCount} elements`, async () => {
      const owner = await seedUserWithSession(`perf-${elementCount}`);
      const { diagramId } = await seedDiagramAs(owner.cookies, `${elementCount}`);

      await seedLargeScene(diagramId, owner.user.id, elementCount, elementCount);

      // --- Bootstrap latency: GET /diagrams/:id/bootstrap against the already-persisted
      // large scene (folds the full op-log — see scene.ts's own TODO about snapshot-based
      // incremental loading, a documented future optimization, not this task's scope). ---
      const bootstrapSamplesMs: number[] = [];
      for (let i = 0; i < SAMPLE_COUNT; i++) {
        const ms = await timeMs(async () => {
          const response = await app.inject({
            method: 'GET',
            url: `/diagrams/${diagramId}/bootstrap`,
            cookies: owner.cookies,
          });
          expect(response.statusCode).toBe(200);
          expect(response.json().scene).toHaveLength(elementCount);
        });
        bootstrapSamplesMs.push(ms);
      }
      bootstrapSamplesMs.sort((a, b) => a - b);
      const bootstrapP95 = percentile(bootstrapSamplesMs, 95);

      // --- ACK latency: a typical (20-50 delta) mutation batch appended on top of the
      // already-large scene — the realistic "user keeps editing a big diagram" case. ---
      const ackSamplesMs: number[] = [];
      for (let i = 0; i < SAMPLE_COUNT; i++) {
        const ms = await timeMs(async () => {
          const response = await app.inject({
            method: 'POST',
            url: `/diagrams/${diagramId}/operations:batch`,
            cookies: owner.cookies,
            payload: typicalBatchEnvelope(owner.user.id, elementCount * 1000 + i),
          });
          expect(response.statusCode).toBe(200);
        });
        ackSamplesMs.push(ms);
      }
      ackSamplesMs.sort((a, b) => a - b);
      const ackP95 = percentile(ackSamplesMs, 95);

      // Results always logged — not just a binary pass/fail — per T94's own "Done when".
      console.log(
        `[PERF-01 T94] elements=${elementCount} ` +
          `bootstrap p95=${bootstrapP95.toFixed(1)}ms samples=[${bootstrapSamplesMs.map((v) => v.toFixed(1)).join(', ')}]ms ` +
          `ack p95=${ackP95.toFixed(1)}ms samples=[${ackSamplesMs.map((v) => v.toFixed(1)).join(', ')}]ms`,
      );

      // Bootstrap target is documented ONLY at 5k elements (§11). 1k is asserted against
      // the same ceiling as a strictly-easier sanity check. 10k has no documented target
      // — measured and logged above, deliberately not asserted here.
      if (elementCount <= BOOTSTRAP_TARGET_ELEMENT_COUNT) {
        expect(bootstrapP95).toBeLessThan(BOOTSTRAP_P95_TARGET_MS);
      }

      // ACK target (§11) is scene-size-agnostic ("lote normal" on top of whatever the
      // diagram already contains) — asserted at every scene size, including 10k.
      expect(ackP95).toBeLessThan(ACK_P95_TARGET_MS);
    }, 120_000);
  });
});
