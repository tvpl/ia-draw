import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { INVENTORY_PATH, runAudit } from './cli.js';

let scratch: string | undefined;

const ROUTES = [
  "app.get('/me', handler);",
  "app.get('/diagrams/:id/lint', handler);",
  "app.post('/presentations', handler);",
].join('\n');

const CONSUMER = "const me = await fetch('/me');";

/**
 * A minimal repository: three registered routes, one of them consumed by the
 * web app, plus the capability map the audit checks.
 */
function fakeRepo(capabilityMap: string): string {
  scratch = mkdtempSync(join(tmpdir(), 'repo-tools-cli-'));
  const files: Record<string, string> = {
    'apps/server/src/modules/example/routes.ts': ROUTES,
    'apps/web/src/diagram/DiagramEditorPage.tsx': CONSUMER,
    'docs/capability-map.yaml': capabilityMap,
  };
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = join(scratch, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, 'utf8');
  }
  return scratch;
}

const CLEAN_MAP = `capabilities:
  - capability: Sessão autenticada
    requirements: [AUTH-01]
    backend_evidence: apps/server/src/modules/example/routes.ts
    ui_surface: apps/web/src/diagram/DiagramEditorPage.tsx
  - capability: Lint arquitetural
    requirements: [LNT-01]
    backend_evidence: apps/server/src/modules/example/routes.ts
    ui_surface: null
    status: backend-only
`;

const DIVERGENT_MAP = `capabilities:
  - capability: Dock de IA
    requirements: [AIG-01]
    backend_evidence: apps/server/src/modules/example/routes.ts
    ui_surface: apps/web/src/ai/AiDock.tsx
  - capability: Apresentação
    requirements: [PRS-01]
    backend_evidence: apps/server/src/modules/example/routes.ts
    ui_surface: apps/web/src/presentation/PresenterMode.tsx
`;

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

describe('repo-tools audit (TRU-03, UIX-01)', () => {
  it('exits non-zero when the capability map diverges from the code', () => {
    const result = runAudit(fakeRepo(DIVERGENT_MAP));

    expect(result.exitCode).toBe(1);
  });

  it('prints every offending entry, not just the first', () => {
    const result = runAudit(fakeRepo(DIVERGENT_MAP));

    expect(result.output.some((line) => line.includes('Dock de IA'))).toBe(true);
    expect(result.output.some((line) => line.includes('Apresentação'))).toBe(true);
  });

  it('writes the inventory to docs/route-inventory.md grouped by classification', () => {
    const root = fakeRepo(CLEAN_MAP);

    runAudit(root);
    const artifact = readFileSync(join(root, INVENTORY_PATH), 'utf8');

    expect(INVENTORY_PATH).toBe('docs/route-inventory.md');
    expect(artifact).toContain('## consumed (1)');
    expect(artifact).toContain('## pending-product (2)');
    expect(artifact).toMatch(
      /## consumed \(1\)[\s\S]*\| GET \| `\/me` \|[\s\S]*## pending-product \(2\)/,
    );
    expect(artifact).toMatch(/## pending-product \(2\)[\s\S]*\| GET \| `\/diagrams\/:id\/lint` \|/);
  });

  it('exits zero and still writes the artifact when nothing diverges', () => {
    const root = fakeRepo(CLEAN_MAP);

    const result = runAudit(root);

    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(root, INVENTORY_PATH), 'utf8')).toContain('# Inventário de rotas');
  });

  it('fails with an explicit message on an invalid repository path, never a stack trace', () => {
    const result = runAudit(join(tmpdir(), 'repo-tools-does-not-exist'));

    expect(result.exitCode).toBe(1);
    expect(result.output).toEqual([
      `repo-tools audit: not a repository directory: ${join(tmpdir(), 'repo-tools-does-not-exist')}`,
    ]);
  });
});
