import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { checkCapabilityMap } from './capabilityMap.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let scratch: string | undefined;

/** Builds a throwaway repo root whose `apps/web/src` contains the given files. */
function fakeRepo(files: string[]): string {
  scratch = mkdtempSync(join(tmpdir(), 'repo-tools-capabilities-'));
  for (const relative of files) {
    const absolute = join(scratch, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, '', 'utf8');
  }
  return scratch;
}

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

describe('checkCapabilityMap (TRU-02, TRU-03)', () => {
  it('fails naming the entry when ui_surface points at a path that does not exist', () => {
    const root = fakeRepo(['apps/web/src/app-shell/AppShell.tsx']);

    const violations = checkCapabilityMap(
      {
        capabilities: [
          {
            capability: 'Dock de IA',
            requirements: ['AIG-01'],
            backend_evidence: 'apps/server/src/modules/ai-engine/routes.ts',
            ui_surface: 'apps/web/src/ai/AiDock.tsx',
          },
        ],
      },
      root,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.entry).toBe('Dock de IA');
    expect(violations[0]?.problem).toContain('apps/web/src/ai/AiDock.tsx');
  });

  it('fails naming the entry when ui_surface points outside apps/web/src', () => {
    const root = fakeRepo(['apps/server/src/modules/lint/routes.ts']);

    const violations = checkCapabilityMap(
      {
        capabilities: [
          {
            capability: 'Lint arquitetural',
            requirements: ['LNT-01'],
            backend_evidence: 'apps/server/src/modules/lint/routes.ts',
            ui_surface: 'apps/server/src/modules/lint/routes.ts',
          },
        ],
      },
      root,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.entry).toBe('Lint arquitetural');
    expect(violations[0]?.problem).toContain('apps/web/src');
  });

  it('fails naming the entry when ui_surface is a file that exists but is not a component', () => {
    // The exact mutation that survived round 1 (validation.md, M6): an existing
    // file under apps/web/src that is not a surface for anything.
    const root = fakeRepo(['apps/web/src/i18n/locales/en/translation.json']);

    const violations = checkCapabilityMap(
      {
        capabilities: [
          {
            capability: 'Recuperação após crash do navegador',
            requirements: ['REC-01'],
            backend_evidence: 'apps/server/src/modules/diagram-sync/routes.ts',
            ui_surface: 'apps/web/src/i18n/locales/en/translation.json',
          },
        ],
      },
      root,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.entry).toBe('Recuperação após crash do navegador');
    expect(violations[0]?.problem).toContain('apps/web/src/i18n/locales/en/translation.json');
    expect(violations[0]?.problem).toContain('not a UI component module');
  });

  it('rejects a locale file even when it carries a module extension', () => {
    const root = fakeRepo(['apps/web/src/i18n/locales/pt-BR/translation.ts']);

    const violations = checkCapabilityMap(
      {
        capabilities: [
          {
            capability: 'Idioma da interface',
            requirements: ['A11Y-01'],
            backend_evidence: 'apps/server/src/core/server.ts',
            ui_surface: 'apps/web/src/i18n/locales/pt-BR/translation.ts',
          },
        ],
      },
      root,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.entry).toBe('Idioma da interface');
    expect(violations[0]?.problem).toContain('not a UI component module');
  });

  it('rejects a test file and a type declaration as a declared surface', () => {
    const root = fakeRepo(['apps/web/src/sync/syncClient.spec.ts', 'apps/web/src/vite-env.d.ts']);

    const violations = checkCapabilityMap(
      {
        capabilities: [
          {
            capability: 'Fila de mutações',
            requirements: ['REC-02'],
            backend_evidence: 'apps/server/src/modules/diagram-sync/routes.ts',
            ui_surface: 'apps/web/src/sync/syncClient.spec.ts',
          },
          {
            capability: 'Tipos do bundler',
            requirements: ['FND-01'],
            backend_evidence: 'apps/server/src/core/server.ts',
            ui_surface: 'apps/web/src/vite-env.d.ts',
          },
        ],
      },
      root,
    );

    expect(violations.map((violation) => violation.entry)).toEqual([
      'Fila de mutações',
      'Tipos do bundler',
    ]);
    expect(
      violations.every((violation) => violation.problem.includes('not a UI component module')),
    ).toBe(true);
  });

  it('fails when an entry has a null ui_surface without status backend-only', () => {
    const root = fakeRepo([]);

    const violations = checkCapabilityMap(
      {
        capabilities: [
          {
            capability: 'Comentários',
            requirements: ['CMT-01'],
            backend_evidence: 'apps/server/src/modules/comment/routes.ts',
            ui_surface: null,
          },
        ],
      },
      root,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.entry).toBe('Comentários');
    expect(violations[0]?.problem).toContain('backend-only');
  });

  it('accepts a null ui_surface that is explicitly classified as backend-only', () => {
    const root = fakeRepo([]);

    const violations = checkCapabilityMap(
      {
        capabilities: [
          {
            capability: 'Comentários',
            requirements: ['CMT-01'],
            backend_evidence: 'apps/server/src/modules/comment/routes.ts',
            ui_surface: null,
            status: 'backend-only',
          },
        ],
      },
      root,
    );

    expect(violations).toEqual([]);
  });

  it('fails a backend-only capability whose module already has a consumer (DOCS-05)', () => {
    const root = fakeRepo(['apps/web/src/lint/LintPanel.tsx']);

    const violations = checkCapabilityMap(
      {
        capabilities: [
          {
            capability: 'Lint arquitetural',
            requirements: ['LNT-01'],
            backend_evidence: 'apps/server/src/modules/lint/routes.ts',
            ui_surface: null,
            status: 'backend-only',
          },
        ],
      },
      root,
      new Map([['apps/server/src/modules/lint/routes.ts', ['apps/web/src/lint/lintClient.ts']]]),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.entry).toBe('Lint arquitetural');
    expect(violations[0]?.problem).toContain('apps/server/src/modules/lint/routes.ts');
    expect(violations[0]?.problem).toContain('apps/web/src/lint/lintClient.ts');
  });

  it('still accepts backend-only when no route of that module is consumed (DOCS-08)', () => {
    // Removing a screen has to be accepted without hand intervention: the same map that
    // failed above passes once the consumer is gone, with no edit to the map itself.
    const root = fakeRepo(['apps/web/src/lint/LintPanel.tsx']);

    const violations = checkCapabilityMap(
      {
        capabilities: [
          {
            capability: 'Lint arquitetural',
            requirements: ['LNT-01'],
            backend_evidence: 'apps/server/src/modules/lint/routes.ts',
            ui_surface: null,
            status: 'backend-only',
          },
        ],
      },
      root,
      new Map([['apps/server/src/modules/comment/routes.ts', ['apps/web/src/comment/Panel.tsx']]]),
    );

    expect(violations).toEqual([]);
  });

  it('fails on an empty map instead of passing vacuously', () => {
    const root = fakeRepo([]);

    expect(checkCapabilityMap({ capabilities: [] }, root)).toHaveLength(1);
    expect(checkCapabilityMap({}, root)).toHaveLength(1);
  });

  it('fails naming the missing field when an entry omits a required one', () => {
    const root = fakeRepo([]);

    const violations = checkCapabilityMap(
      {
        capabilities: [
          {
            capability: 'Docgen',
            requirements: ['DOC-01'],
            ui_surface: null,
            status: 'backend-only',
          },
          {
            requirements: ['LIB-01'],
            backend_evidence: 'x.ts',
            ui_surface: null,
            status: 'backend-only',
          },
        ],
      },
      root,
    );

    expect(violations).toHaveLength(2);
    expect(violations[0]).toEqual({
      entry: 'Docgen',
      problem: 'missing required field `backend_evidence`',
    });
    expect(violations[1]).toEqual({
      entry: 'capabilities[1]',
      problem: 'missing required field `capability`',
    });
  });

  it('passes against the real docs/capability-map.yaml', () => {
    const map = parse(readFileSync(join(REPO_ROOT, 'docs/capability-map.yaml'), 'utf8'));

    expect(checkCapabilityMap(map, REPO_ROOT)).toEqual([]);
  });
});
