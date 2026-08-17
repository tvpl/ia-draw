import { type LibraryItem, libraryManifestSchema } from '@arch-canvas/library-content';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createResourceListStore } from '../nav/resourceListStore.js';
import { createLibraryClient } from './libraryClient.js';

/**
 * One item flattened out of a `GET /libraries` row's `manifestJson` (design.md
 * "Data Models"). `id` combines `libraryId` + `stableKey` — the same `stableKey` can
 * legitimately appear in more than one visible library (global + workspace), and
 * spec.md's Edge Cases require both to be listed separately, never deduplicated.
 * Reuses `createResourceListStore` (`../nav/resourceListStore.js`, `T extends { id }`)
 * instead of a bespoke store.
 */
interface LibraryEntry {
  id: string;
  libraryId: string;
  item: LibraryItem;
}

function flattenRows(rows: readonly { id: string; manifestJson: unknown }[]): LibraryEntry[] {
  const entries: LibraryEntry[] = [];
  for (const row of rows) {
    const parsed = libraryManifestSchema.safeParse(row.manifestJson);
    if (!parsed.success) continue;
    for (const item of parsed.data.items) {
      entries.push({ id: `${row.id}:${item.stableKey}`, libraryId: row.id, item });
    }
  }
  return entries;
}

function matchesSearch(item: LibraryItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (item.name.toLowerCase().includes(needle)) return true;
  if (item.aliases.some((alias) => alias.toLowerCase().includes(needle))) return true;
  if (item.tags.some((tag) => tag.toLowerCase().includes(needle))) return true;
  return false;
}

export interface LibraryPanelProps {
  /** Current workspace, scoping `GET /libraries?workspaceId=` alongside the always-included global library (CLIB-01). */
  workspaceId?: string;
  /** `mutatePermissions.allowed`/`diagram:write` — same source `DiagramEditorPage` already resolves for `AiDock` (T8, design.md). `false` renders the panel read-only: browse and view, no insert button (CLIB-05). */
  canWrite: boolean;
  /** Called with the raw `LibraryItem` when "insert" is pressed — `DiagramEditorPage` wires this to `EditorSurfaceHandle.insertLibraryItem` (design.md Approach A; this component never touches the canvas ref directly). */
  onInsert: (item: LibraryItem) => void;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * The library browse/insert panel (CLIB-01..07) — lists every visible library's items
 * grouped by category, filters client-side over the already-loaded payload (CLIB-02,
 * no extra network call), and inserts the clicked item via `onInsert`. Loading and
 * error(+retry) states are explicit (CLIB-06/07) so a slow/failed fetch never reads as
 * "the library has no items".
 */
export function LibraryPanel({
  workspaceId,
  canWrite,
  onInsert,
  fetchImpl,
}: LibraryPanelProps): JSX.Element {
  const { t } = useTranslation();

  const store = useMemo(() => createResourceListStore<LibraryEntry>(), []);
  const client = useMemo(() => createLibraryClient(fetchImpl), [fetchImpl]);

  const entries = store((s) => s.items);
  const status = store((s) => s.status);
  const setItems = store((s) => s.setItems);
  const setError = store((s) => s.setError);

  const [search, setSearch] = useState('');
  const [announcement, setAnnouncement] = useState('');

  /** Fetches (or re-fetches, on retry) the visible libraries. Returns a cleanup that marks the
   * in-flight request stale, so a component unmount (or a rapid `workspaceId` change) never
   * lands a resolved promise from a superseded request. */
  const load = useCallback((): (() => void) => {
    let cancelled = false;
    client.list(workspaceId).then(
      (rows) => {
        if (!cancelled) setItems(flattenRows(rows));
      },
      () => {
        if (!cancelled) setError();
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, workspaceId, setItems, setError]);

  useEffect(() => load(), [load]);

  const grouped = useMemo(() => {
    const visible = entries.filter((entry) => matchesSearch(entry.item, search));
    const byCategory = new Map<string, LibraryEntry[]>();
    for (const entry of visible) {
      const bucket = byCategory.get(entry.item.category);
      if (bucket) bucket.push(entry);
      else byCategory.set(entry.item.category, [entry]);
    }
    return byCategory;
  }, [entries, search]);

  function handleInsert(item: LibraryItem): void {
    onInsert(item);
    setAnnouncement(t('library.inserted', { name: item.name }));
  }

  const hasEntries = entries.length > 0;
  const hasVisibleEntries = grouped.size > 0;

  return (
    <div>
      <div aria-live="polite" data-testid="library-announcement">
        {announcement}
      </div>

      <label>
        {t('library.searchLabel')}
        <input value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>

      {status === 'loading' && <p>{t('library.loading')}</p>}

      {status === 'error' && (
        <div>
          <p>{t('library.error')}</p>
          <button type="button" onClick={() => load()}>
            {t('library.retry')}
          </button>
        </div>
      )}

      {status === 'ready' && hasEntries && !hasVisibleEntries && <p>{t('library.emptySearch')}</p>}

      {status === 'ready' &&
        Array.from(grouped.entries()).map(([category, categoryEntries]) => (
          <section key={category}>
            <h3>{category}</h3>
            <ul>
              {categoryEntries.map((entry) => (
                <li key={entry.id}>
                  <span>{entry.item.name}</span>
                  {canWrite && (
                    <button type="button" onClick={() => handleInsert(entry.item)}>
                      {t('library.insert')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
