import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { extractWebConsumers } from './webConsumers.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let scratch: string | undefined;

/** Builds a throwaway repo root containing the given `path -> contents` files. */
function fakeRepo(files: Record<string, string>): string {
  scratch = mkdtempSync(join(tmpdir(), 'repo-tools-consumers-'));
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = join(scratch, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, 'utf8');
  }
  return scratch;
}

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

describe('extractWebConsumers (UIX-01)', () => {
  it('recognizes a fetch call with a literal path', () => {
    const root = fakeRepo({
      'apps/web/src/diagram/DiagramEditorPage.tsx':
        "const me = await fetch('/me').then(r => r.json());",
    });

    expect(extractWebConsumers(root)).toEqual([
      {
        path: '/me',
        expression: "'/me'",
        file: 'apps/web/src/diagram/DiagramEditorPage.tsx',
        resolvable: true,
      },
    ]);
  });

  it('normalizes ${...} interpolation in a template literal to the parameter segment', () => {
    const root = fakeRepo({
      'apps/web/src/sync/syncClient.ts':
        'const response = await fetch(`/diagrams/${this.diagramId}/bootstrap`);',
    });

    const consumers = extractWebConsumers(root);

    expect(consumers).toHaveLength(1);
    expect(consumers[0]?.path).toBe('/diagrams/:param/bootstrap');
    expect(consumers[0]?.resolvable).toBe(true);
  });

  it('recognizes the injected fetchImpl form and strips the query string from the path', () => {
    const root = fakeRepo({
      'apps/web/src/sync/syncClient.ts':
        'const response = await this.fetchImpl(`/diagrams/${this.diagramId}/operations?afterSequence=${this.knownRevision}`);',
    });

    const consumers = extractWebConsumers(root);

    expect(consumers).toHaveLength(1);
    expect(consumers[0]?.path).toBe('/diagrams/:param/operations');
    expect(consumers[0]?.expression).toBe(
      '`/diagrams/${this.diagramId}/operations?afterSequence=${this.knownRevision}`',
    );
  });

  it('reports a url assembled from a variable as unresolvable instead of dropping it', () => {
    const root = fakeRepo({
      'apps/web/src/sync/dynamic.ts': "const response = await fetch(base + '/diagrams');",
    });

    const consumers = extractWebConsumers(root);

    expect(consumers).toHaveLength(1);
    expect(consumers[0]?.resolvable).toBe(false);
    expect(consumers[0]?.path).toBe('');
    expect(consumers[0]?.expression).toBe("base + '/diagrams'");
    expect(consumers[0]?.file).toBe('apps/web/src/sync/dynamic.ts');
  });

  it('does not count a frontend test file as a production consumer', () => {
    const root = fakeRepo({
      'apps/web/src/sync/syncClient.ts': "await fetch('/me');",
      'apps/web/src/sync/syncClient.spec.ts': "await fetch('/test-only-endpoint');",
    });

    const consumers = extractWebConsumers(root);

    expect(consumers.map((consumer) => consumer.path)).toEqual(['/me']);
  });

  it('finds exactly the 4 endpoints the real web app consumes today', () => {
    const consumers = extractWebConsumers(REPO_ROOT);

    expect(consumers).toHaveLength(4);
    expect(consumers.map((consumer) => consumer.path)).toEqual([
      '/me',
      '/diagrams/:param/bootstrap',
      '/diagrams/:param/operations:batch',
      '/diagrams/:param/operations',
    ]);
    expect(consumers.every((consumer) => consumer.resolvable)).toBe(true);
  });
});
