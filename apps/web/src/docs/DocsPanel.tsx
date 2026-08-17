import { type JSX, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createDocgenClient, type SpecDocumentRow } from './docgenClient.js';
import type { SectionName } from './parseSpecMarkdown.js';
import { SpecViewer } from './SpecViewer.js';

export interface DocsPanelProps {
  diagramId: string;
  /** Gates "Gerar documento" and every per-section "Regenerar esta seção" (LDC-06/01) — same `diagram:mutate` boolean every other panel in this codebase receives. */
  canMutate: boolean;
  /** Element ids of the scene this editor session loaded — passed straight through to `SpecViewer` (LDC-06). */
  liveElementIds: readonly string[];
  /** Injectable for tests; defaults to the global fetch (same convention as `AiDock`/`HistoryPanel`). Used both for `docgenClient` calls and for fetching a selected version's `markdownUrl` content directly. */
  fetchImpl?: typeof fetch;
}

type ListStatus = 'loading' | 'ready' | 'error';
type ContentStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * The living-docs panel (spec.md LDC-01..30): lists generated spec versions, offers generating a
 * new one, lets the user select a version to read (fetching its Markdown lazily via the signed
 * `markdownUrl` T1 added), and wires `SpecViewer`'s per-section regenerate control to
 * `docgenClient.regenerateSection`.
 */
export function DocsPanel({
  diagramId,
  canMutate,
  liveElementIds,
  fetchImpl,
}: DocsPanelProps): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => createDocgenClient(fetchImpl), [fetchImpl]);
  // Same binding rationale as every other client in this codebase — a bare `fetch` reference
  // loses `window` as its receiver in real browsers.
  const doFetch = useMemo(() => fetchImpl ?? fetch.bind(globalThis), [fetchImpl]);

  const [items, setItems] = useState<SpecDocumentRow[]>([]);
  const [listStatus, setListStatus] = useState<ListStatus>('loading');
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contentStatus, setContentStatus] = useState<ContentStatus>('idle');
  const [contentMarkdown, setContentMarkdown] = useState('');
  // LDC-19: a later selection's content fetch always wins over an earlier still-pending one.
  const contentRequestIdRef = useRef(0);

  const [generating, setGenerating] = useState(false);
  const [regeneratingSection, setRegeneratingSection] = useState<SectionName | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    let cancelled = false;
    setListStatus('loading');
    client.list(diagramId).then((result) => {
      if (cancelled) return;
      if (result.status === 'ok') {
        setItems(result.specs);
        setNextCursor(result.nextCursor);
        setListStatus('ready');
        return;
      }
      setListStatus('error');
    });
    return () => {
      cancelled = true;
    };
  }, [client, diagramId]);

  async function fetchContentFor(spec: SpecDocumentRow): Promise<void> {
    const requestId = ++contentRequestIdRef.current;
    setSelectedId(spec.id);
    setContentStatus('loading');
    try {
      const response = await doFetch(spec.markdownUrl);
      if (requestId !== contentRequestIdRef.current) return; // LDC-19: superseded by a later selection.
      if (!response.ok) {
        setContentStatus('error');
        return;
      }
      const text = await response.text();
      if (requestId !== contentRequestIdRef.current) return;
      setContentMarkdown(text);
      setContentStatus('ready');
    } catch {
      if (requestId !== contentRequestIdRef.current) return;
      setContentStatus('error');
    }
  }

  async function handleLoadMore(): Promise<void> {
    if (loadingMore || nextCursor === null) return;
    setLoadingMore(true);
    try {
      const result = await client.list(diagramId, nextCursor);
      if (result.status === 'ok') {
        setItems((current) => [...current, ...result.specs]);
        setNextCursor(result.nextCursor);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleGenerate(): Promise<void> {
    if (generating) return;
    setGenerating(true);
    try {
      const result = await client.generate(diagramId);
      if (result.status === 'created') {
        setItems((current) => [result.spec, ...current]);
        setAnnouncement(t('docs.announce.generated'));
        await fetchContentFor(result.spec);
        return;
      }
      setAnnouncement(
        result.status === 'forbidden'
          ? t('docs.announce.generateForbidden')
          : t('docs.announce.generateError'),
      );
    } finally {
      setGenerating(false);
    }
  }

  async function handleRegenerateSection(section: SectionName): Promise<void> {
    if (regeneratingSection) return;
    const current = items.find((item) => item.id === selectedId);
    if (current?.status !== 'current') return;

    setRegeneratingSection(section);
    try {
      const result = await client.regenerateSection(diagramId, current.version, section);
      if (result.status === 'created') {
        setItems((existing) => [
          result.spec,
          ...existing.map((item) =>
            item.id === current.id ? { ...item, status: 'superseded' as const } : item,
          ),
        ]);
        setAnnouncement(t('docs.announce.regenerated'));
        await fetchContentFor(result.spec);
        return;
      }
      setAnnouncement(
        result.status === 'forbidden'
          ? t('docs.announce.regenerateForbidden')
          : result.status === 'not_found'
            ? t('docs.announce.regenerateNotFound')
            : t('docs.announce.regenerateError'),
      );
    } finally {
      setRegeneratingSection(null);
    }
  }

  const selectedSpec = items.find((item) => item.id === selectedId) ?? null;
  const showEmptyState = listStatus === 'ready' && items.length === 0;

  return (
    <section aria-labelledby="docs-title">
      <h2 id="docs-title">{t('docs.title')}</h2>

      <div aria-live="polite" data-testid="docs-announcement">
        {announcement}
      </div>

      {listStatus === 'loading' && <p>{t('docs.loading')}</p>}
      {listStatus === 'error' && <p>{t('docs.error')}</p>}
      {showEmptyState && <p>{t('docs.emptyState')}</p>}

      {listStatus === 'ready' && items.length > 0 && (
        <ul>
          {items.map((item) => (
            <li key={item.id} data-testid="docs-version-item">
              <button
                type="button"
                aria-pressed={item.id === selectedId}
                onClick={() => void fetchContentFor(item)}
              >
                {t('docs.versionLabel', { version: item.version })}
              </button>
              <span>{t(`docs.status.${item.status}`)}</span>
            </li>
          ))}
        </ul>
      )}

      {listStatus === 'ready' && nextCursor !== null && (
        <button type="button" onClick={() => void handleLoadMore()} disabled={loadingMore}>
          {t('docs.loadMore')}
        </button>
      )}

      {canMutate && (
        <button type="button" onClick={() => void handleGenerate()} disabled={generating}>
          {t('docs.generate')}
        </button>
      )}

      {selectedSpec && contentStatus === 'loading' && <p>{t('docs.contentLoading')}</p>}
      {selectedSpec && contentStatus === 'error' && <p>{t('docs.contentError')}</p>}
      {selectedSpec && contentStatus === 'ready' && (
        <SpecViewer
          markdown={contentMarkdown}
          liveElementIds={liveElementIds}
          status={selectedSpec.status}
          canMutate={canMutate}
          onRegenerateSection={(section) => void handleRegenerateSection(section)}
        />
      )}
    </section>
  );
}
