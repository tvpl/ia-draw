import { z, type ZodType } from 'zod';
import type { RouteSchemaMap } from './types.js';

/** OpenAPI 3.1 document produced from a merged `RouteSchemaMap` registry. */
export interface OpenApiDocument {
  openapi: '3.1.0';
  info: { title: string; version: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
}

interface OpenApiParameter {
  name: string;
  in: 'query' | 'path';
  required: boolean;
  schema: unknown;
}

interface OpenApiOperation {
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: { content: { 'application/json': { schema: unknown } } };
  responses?: Record<
    string,
    { description: string; content?: { 'application/json': { schema: unknown } } }
  >;
}

/**
 * `:id(^[^:]+):complete` (a Fastify regex-constrained param, optionally
 * followed by an RPC-style literal suffix like `asset/routes.ts` uses) — only
 * the param name gets templated (`{id}`); the regex constraint is dropped and
 * the literal suffix stays outside the braces so two routes that differ only
 * by suffix never collapse onto the same OpenAPI path.
 */
const PARAM_SEGMENT = /^:([A-Za-z0-9_]+)(?:\([^)]*\))?(:.*)?$/;

/** Converts a Fastify route path into an OpenAPI path template: `:id` -> `{id}`. */
function toOpenApiPath(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      const match = PARAM_SEGMENT.exec(segment);
      if (!match) return segment;
      const [, name, suffix] = match;
      return `{${name}}${suffix ?? ''}`;
    })
    .join('/');
}

/** Expands an object-shaped Zod schema into one OpenAPI parameter per field. */
function toParameters(schema: ZodType | undefined, location: 'query' | 'path'): OpenApiParameter[] {
  if (!schema) return [];
  const jsonSchema = z.toJSONSchema(schema) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  const required = new Set(jsonSchema.required ?? []);
  return Object.entries(jsonSchema.properties ?? {}).map(([name, propSchema]) => ({
    name,
    in: location,
    required: required.has(name),
    schema: propSchema,
  }));
}

function toRequestBody(schema: ZodType | undefined): OpenApiOperation['requestBody'] {
  if (!schema) return undefined;
  return { content: { 'application/json': { schema: z.toJSONSchema(schema) } } };
}

function toResponses(schema: ZodType | undefined): OpenApiOperation['responses'] {
  if (!schema) return { '200': { description: 'Successful response' } };
  return {
    '200': {
      description: 'Successful response',
      content: { 'application/json': { schema: z.toJSONSchema(schema) } },
    },
  };
}

function toOperation(schemas: RouteSchemaMap[string]): OpenApiOperation {
  if (schemas.websocket) {
    return { description: 'WebSocket upgrade route (not a JSON request/response endpoint)' };
  }

  const parameters = [...toParameters(schemas.params, 'path'), ...toParameters(schemas.query, 'query')];
  return {
    parameters: parameters.length > 0 ? parameters : undefined,
    requestBody: toRequestBody(schemas.body),
    responses: toResponses(schemas.response),
  };
}

/**
 * Builds an OpenAPI 3.1 document from a registry of per-module
 * `RouteSchemaMap`s (API-01), converting every Zod schema via Zod 4's
 * native `z.toJSONSchema()` — no separate JSON Schema library needed.
 *
 * A registry with no routes at all throws instead of returning an empty
 * document, so a broken registry never gets silently published as a
 * contract with nothing in it (spec.md Edge Case: "IF a geração do OpenAPI
 * produzir um documento sem nenhuma rota THEN o CI SHALL falhar").
 */
export function buildOpenApiDocument(registry: Record<string, RouteSchemaMap>): OpenApiDocument {
  const paths: OpenApiDocument['paths'] = {};
  let routeCount = 0;

  for (const routeSchemas of Object.values(registry)) {
    for (const [key, schemas] of Object.entries(routeSchemas)) {
      const spaceIndex = key.indexOf(' ');
      const method = key.slice(0, spaceIndex).toLowerCase();
      const path = toOpenApiPath(key.slice(spaceIndex + 1));

      paths[path] ??= {};
      paths[path][method] = toOperation(schemas);
      routeCount += 1;
    }
  }

  if (routeCount === 0) {
    throw new Error(
      'buildOpenApiDocument: registry contains no routes — refusing to publish an empty OpenAPI document',
    );
  }

  return {
    openapi: '3.1.0',
    info: { title: '@arch-canvas/server API', version: '1.0.0' },
    paths,
  };
}
