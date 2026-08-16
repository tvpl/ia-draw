#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument } from './buildDocument.js';
import { registry } from './registry.js';

/** Generated OpenAPI contract, relative to the repo root (API-01). */
export const OPENAPI_OUTPUT_PATH = 'docs/openapi.json';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const document = buildOpenApiDocument(registry);
const outputPath = join(REPO_ROOT, ...OPENAPI_OUTPUT_PATH.split('/'));
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

process.stdout.write(
  `openapi: wrote ${OPENAPI_OUTPUT_PATH} — ${Object.keys(document.paths).length} paths\n`,
);
