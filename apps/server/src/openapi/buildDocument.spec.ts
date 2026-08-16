import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildOpenApiDocument } from './buildDocument.js';
import type { RouteSchemaMap } from './types.js';

describe('buildOpenApiDocument (T2, API-01)', () => {
  it('produces a valid OpenAPI 3.1 document with the required top-level keys', () => {
    const doc = buildOpenApiDocument({ mod: { 'GET /x': {} } });

    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info).toBeDefined();
    expect(doc.paths).toBeDefined();
  });

  it('converts query, body and response Zod schemas into their OpenAPI shapes', () => {
    const registry: Record<string, RouteSchemaMap> = {
      mod: {
        'POST /things': {
          query: z.object({ scope: z.string().optional() }),
          body: z.object({ name: z.string() }),
          response: z.object({ id: z.string() }),
        },
      },
    };

    const doc = buildOpenApiDocument(registry);
    const operation = doc.paths['/things']?.post;

    expect(operation?.parameters).toEqual([
      { name: 'scope', in: 'query', required: false, schema: { type: 'string' } },
    ]);
    expect(operation?.requestBody?.content['application/json'].schema).toMatchObject({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    });
    expect(operation?.responses?.['200']?.content?.['application/json'].schema).toMatchObject({
      type: 'object',
      properties: { id: { type: 'string' } },
    });
  });

  it('documents a websocket route without a requestBody or a JSON responses map', () => {
    const registry: Record<string, RouteSchemaMap> = {
      mod: { 'GET /ws/sync': { websocket: true } },
    };

    const doc = buildOpenApiDocument(registry);
    const operation = doc.paths['/ws/sync']?.get;

    expect(operation?.requestBody).toBeUndefined();
    expect(operation?.responses).toBeUndefined();
    expect(operation?.description).toContain('WebSocket');
  });

  it('throws citing the empty registry instead of returning an empty document', () => {
    expect(() => buildOpenApiDocument({})).toThrow(/no routes/i);
    expect(() => buildOpenApiDocument({ mod: {} })).toThrow(/no routes/i);
  });

  it('merges routes from multiple modules into one document', () => {
    const registry: Record<string, RouteSchemaMap> = {
      moduleA: { 'GET /a': {} },
      moduleB: { 'GET /b': {} },
    };

    const doc = buildOpenApiDocument(registry);

    expect(Object.keys(doc.paths).sort()).toEqual(['/a', '/b']);
    expect(doc.paths['/a']?.get).toBeDefined();
    expect(doc.paths['/b']?.get).toBeDefined();
  });

  it('converts a :id path param into the OpenAPI {id} template', () => {
    const registry: Record<string, RouteSchemaMap> = {
      mod: {
        'PATCH /admin/ai-providers/:id': { params: z.object({ id: z.string() }) },
      },
    };

    const doc = buildOpenApiDocument(registry);

    expect(doc.paths['/admin/ai-providers/{id}']).toBeDefined();
    expect(doc.paths['/admin/ai-providers/:id']).toBeUndefined();
    expect(doc.paths['/admin/ai-providers/{id}']?.patch?.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
  });
});
