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
