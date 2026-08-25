import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRouteInventory } from './routeInventory.js';
import { extractServerRoutes } from './serverRoutes.js';
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

  it('recognizes an injected fetch whatever the client bound it to (DOCS-01)', () => {
    const root = fakeRepo({
      'apps/web/src/lint/lintClient.ts': "await doFetch('/diagrams/1/lint');",
      'apps/web/src/admin/adminClient.ts': "await adminFetch('/users');",
      'apps/web/src/sync/syncClient.ts': 'await this.rawFetchImpl(`/diagrams/${id}/operations`);',
    });

    expect(extractWebConsumers(root).map((consumer) => consumer.path)).toEqual([
      '/users',
      '/diagrams/1/lint',
      '/diagrams/:param/operations',
    ]);
  });

  it('ignores a local helper that merely starts with the word fetch (DOCS-01)', () => {
    const root = fakeRepo({
      'apps/web/src/docs/DocsPanel.tsx': [
        'async function fetchContentFor(spec) {',
        '  return spec.markdownUrl;',
        '}',
        'onClick={() => void fetchContentFor(item)}',
      ].join('\n'),
    });

    expect(extractWebConsumers(root)).toEqual([]);
  });

  it('folds a `${...}` that follows a literal colon into one parameter token', () => {
    const root = fakeRepo({
      'apps/web/src/export/exportClient.ts':
        'await doFetch(`/diagrams/${diagramId}/export:${format}`, { method: "POST" });',
    });

    // The server registers `/diagrams/:id/export:format`; `export::param` would look orphaned.
    expect(extractWebConsumers(root).map((consumer) => consumer.path)).toEqual([
      '/diagrams/:param/export:param',
    ]);
  });

  it('does not count a frontend test file as a production consumer', () => {
    const root = fakeRepo({
      'apps/web/src/sync/syncClient.ts': "await fetch('/me');",
      'apps/web/src/sync/syncClient.spec.ts': "await fetch('/test-only-endpoint');",
    });

    const consumers = extractWebConsumers(root);

    expect(consumers.map((consumer) => consumer.path)).toEqual(['/me']);
  });

  describe('the real repository (GATE-02)', () => {
    // This used to assert `toHaveLength(4)` and the four literal paths the web app consumed
    // when the check was written. The interface grew to 53 consumers and the number was
    // never updated, so `make test-unit` exited 1 on a clean checkout for weeks and stopped
    // being a signal. A count is a snapshot; these are invariants, which do not age.
    const consumers = extractWebConsumers(REPO_ROOT);

    it('finds at least one consumer — zero means the extractor broke, not that the UI is empty', () => {
      expect(consumers.length).toBeGreaterThan(0);
    });

    it('gives every resolvable consumer a path that starts with a single slash', () => {
      // Scoped to `resolvable` because that is what the type promises: a url assembled at
      // runtime comes back with an empty path on purpose (UIX-01), and the repository has
      // six of them — `resourceClient` and `libraryClient` take their url as an argument.
      // The unscoped version of this passed only while no such call was visible to the
      // extractor, which is a property of the old blind spot, not an invariant.
      for (const consumer of consumers.filter((entry) => entry.resolvable)) {
        expect(consumer.path.startsWith('/')).toBe(true);
        expect(consumer.path.startsWith('//')).toBe(false);
      }
    });

    it('reports a runtime-assembled url instead of dropping it', () => {
      const unresolvable = consumers.filter((entry) => !entry.resolvable);

      expect(unresolvable.length).toBeGreaterThan(0);
      for (const consumer of unresolvable) {
        expect(consumer.path).toBe('');
        expect(consumer.expression).not.toBe('');
      }
    });

    it('leaves no unnormalized interpolation in a resolvable path', () => {
      // Not "no duplicate file:path pair": one client legitimately calls the same path with
      // several methods, and the extractor reads no method, so those collapse. 55 consumers
      // over 42 distinct pairs today, and that is correct.
      for (const consumer of consumers.filter((entry) => entry.resolvable)) {
        expect(consumer.path).not.toContain('${');
        expect(consumer.path).not.toContain('`');
      }
    });

    it('points every resolvable consumer at a route the server actually registers', () => {
      // Reuses the inventory's own path matcher rather than restating it: a consumer that
      // matches no registered route is exactly what it calls an `orphan-consumer`.
      const inventory = buildRouteInventory(extractServerRoutes(REPO_ROOT), consumers);
      const resolvableOrphans = inventory.orphanConsumers.filter((orphan) => orphan.resolvable);

      expect(resolvableOrphans.map((orphan) => `${orphan.file} ${orphan.path}`)).toEqual([]);
    });

    it('attributes every consumer to a production file under apps/web/src', () => {
      for (const consumer of consumers) {
        expect(consumer.file.startsWith('apps/web/src/')).toBe(true);
        expect(consumer.file.endsWith('.spec.ts')).toBe(false);
        expect(consumer.file.endsWith('.spec.tsx')).toBe(false);
      }
    });
  });
});
