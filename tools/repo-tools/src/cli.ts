#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { checkCapabilityMap } from './capabilityMap.js';
import { checkCoverageFloors } from './coverageFloors.js';
import { checkOpenApiParity } from './openApiParity.js';
import {
  buildRouteInventory,
  type RouteInventory,
  renderReadmeCounts,
  syncReadmeCounts,
} from './routeInventory.js';
import { extractServerRoutes } from './serverRoutes.js';
import { extractWebConsumers } from './webConsumers.js';

/** The capability map this audit checks, relative to the repo root. */
export const CAPABILITY_MAP_PATH = 'docs/capability-map.yaml';

/** The generated inventory artifact, relative to the repo root. */
export const INVENTORY_PATH = 'docs/route-inventory.md';

export interface AuditResult {
  /** Zero when the repository matches what the capability map claims. */
  exitCode: number;
  /** Lines to print, one per finding. */
  output: string[];
}

function renderInventory(inventory: RouteInventory): string {
  const consumed = inventory.routes.filter((entry) => entry.classification === 'consumed');
  const pending = inventory.routes.filter((entry) => entry.classification === 'pending-product');

  return [
    '# Inventário de rotas',
    '',
    'Gerado por `repo-tools audit`. Não editar à mão.',
    '',
    `- Rotas registradas: ${inventory.totals.routes}`,
    `- Com consumidor de UI (\`consumed\`): ${inventory.totals.consumed}`,
    `- Pendentes de produto (\`pending-product\`): ${inventory.totals.pendingProduct}`,
    `- Consumidores órfãos (\`orphan-consumer\`): ${inventory.totals.orphanConsumers}`,
    '',
    `## consumed (${consumed.length})`,
    '',
    '| Método | Path | Registrada em | Consumida por |',
    '| --- | --- | --- | --- |',
    ...consumed.map(
      (entry) =>
        `| ${entry.method} | \`${entry.path}\` | \`${entry.file}\` | ${entry.consumedBy
          .map((file) => `\`${file}\``)
          .join(', ')} |`,
    ),
    '',
    `## pending-product (${pending.length})`,
    '',
    '| Método | Path | Registrada em |',
    '| --- | --- | --- |',
    ...pending.map((entry) => `| ${entry.method} | \`${entry.path}\` | \`${entry.file}\` |`),
    '',
    `## orphan-consumer (${inventory.orphanConsumers.length})`,
    '',
    '| Endpoint | Chamado em |',
    '| --- | --- |',
    ...inventory.orphanConsumers.map(
      (consumer) => `| \`${consumer.path || consumer.expression}\` | \`${consumer.file}\` |`,
    ),
    '',
  ].join('\n');
}

/**
 * Runs the repository audit against `sourceRoot`: writes the route inventory
 * artifact, checks the capability map against the code (TRU-03, UIX-01),
 * checks that every unit-tested workspace package declares a coverage floor
 * (CIQ-04), then checks the generated OpenAPI document against the same
 * registered routes (API-02).
 *
 * A repository path that cannot be audited comes back as an explicit message
 * and a non-zero exit code, never as a raw stack trace.
 */
export function runAudit(sourceRoot: string): AuditResult {
  if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
    return { exitCode: 1, output: [`repo-tools audit: not a repository directory: ${sourceRoot}`] };
  }

  const mapPath = join(sourceRoot, ...CAPABILITY_MAP_PATH.split('/'));
  if (!existsSync(mapPath)) {
    return {
      exitCode: 1,
      output: [`repo-tools audit: no capability map at ${CAPABILITY_MAP_PATH} under ${sourceRoot}`],
    };
  }

  const inventory = buildRouteInventory(
    extractServerRoutes(sourceRoot),
    extractWebConsumers(sourceRoot),
  );
  const inventoryPath = join(sourceRoot, ...INVENTORY_PATH.split('/'));
  mkdirSync(dirname(inventoryPath), { recursive: true });
  writeFileSync(inventoryPath, renderInventory(inventory), 'utf8');

  const output = [
    `repo-tools audit: wrote ${INVENTORY_PATH} — ${inventory.totals.routes} routes, ` +
      `${inventory.totals.consumed} consumed, ${inventory.totals.pendingProduct} pending-product`,
  ];

  let map: unknown;
  try {
    map = parse(readFileSync(mapPath, 'utf8'));
  } catch (error) {
    output.push(
      `repo-tools audit: could not parse ${CAPABILITY_MAP_PATH}: ${(error as Error).message}`,
    );
    return { exitCode: 1, output };
  }

  // DOCS-05: which server module's routes already have a screen. Built from the inventory
  // just written, so the audit checks the map in BOTH directions from one source of truth.
  const consumersByModule = new Map<string, string[]>();
  for (const entry of inventory.routes) {
    if (entry.classification !== 'consumed') continue;
    const existing = consumersByModule.get(entry.file) ?? [];
    for (const consumer of entry.consumedBy) {
      if (!existing.includes(consumer)) existing.push(consumer);
    }
    consumersByModule.set(entry.file, existing);
  }

  const violations = checkCapabilityMap(map, sourceRoot, consumersByModule);
  for (const violation of violations) {
    output.push(`repo-tools audit: ${violation.entry} — ${violation.problem}`);
  }

  const floorViolations = checkCoverageFloors(sourceRoot);
  for (const violation of floorViolations) {
    output.push(`repo-tools audit: ${violation.package} — ${violation.problem}`);
  }

  // DOCS-01..03: the README's counts come from this measurement, never from memory.
  const capabilityEntries = ((map as { capabilities?: unknown[] } | null)?.capabilities ??
    []) as Array<Record<string, unknown>>;
  const readmeViolations = syncReadmeCounts(
    join(sourceRoot, 'README.md'),
    renderReadmeCounts(inventory, {
      total: capabilityEntries.length,
      withSurface: capabilityEntries.filter((entry) => typeof entry.ui_surface === 'string').length,
    }),
    (path) => readFileSync(path, 'utf8'),
    (path, contents) => writeFileSync(path, contents, 'utf8'),
  );
  for (const violation of readmeViolations) {
    output.push(`repo-tools audit: ${violation.entry} — ${violation.problem}`);
  }

  const openApiViolations = checkOpenApiParity(sourceRoot);
  for (const violation of openApiViolations) {
    output.push(`repo-tools audit: ${violation.entry} — ${violation.problem}`);
  }

  return {
    exitCode:
      violations.length +
        floorViolations.length +
        openApiViolations.length +
        readmeViolations.length >
      0
        ? 1
        : 0,
    output,
  };
}

/** Repo root, derived from this file's location rather than the cwd. */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// The bin is reached through a symlink in node_modules/.bin, so the entry path
// has to be resolved before it can be compared with this module's own url.
const entryPoint = process.argv[1];
const entryUrl = entryPoint ? pathToFileURL(realpathSync(entryPoint)).href : undefined;

if (entryUrl === import.meta.url) {
  if (process.argv[2] !== 'audit') {
    process.stderr.write('usage: repo-tools audit\n');
    process.exitCode = 1;
  } else {
    const result = runAudit(REPO_ROOT);
    for (const line of result.output) process.stdout.write(`${line}\n`);
    process.exitCode = result.exitCode;
  }
}
