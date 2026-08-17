import { type JSX, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createExportClient, type ExportFormats } from './exportClient.js';

export interface ExportMenuProps {
  diagramId: string;
  /** Injectable for tests; defaults to the global fetch (same convention as `AuthProvider`). */
  fetchImpl?: typeof fetch;
}

type Phase = 'idle' | 'generating' | 'ready' | 'rate_limited' | 'error';

const FORMAT_ORDER: Array<keyof ExportFormats> = ['excalidraw', 'svg', 'png', 'pdf'];

const FORMAT_LABEL_KEYS: Record<keyof ExportFormats, string> = {
  excalidraw: 'export.menu.format.excalidraw',
  svg: 'export.menu.format.svg',
  png: 'export.menu.format.png',
  pdf: 'export.menu.format.pdf',
};

/** Human-readable size for the download links (XPRT-01) — single-use here. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Export dropdown for the diagram editor's toolbar (XPRT-01..04) — a native `<details>`
 * disclosure (same keyboard-free-for-free pattern as `AiDock`), starting closed. One click
 * on "generate" issues a single `POST /diagrams/:id/exports` call (spec.md Problem
 * Statement item 1: the route always returns all 4 formats together, so this is never 4
 * separate requests) and renders the 4 signed download links once the response resolves.
 * Each link is a real `<a href>` to the signed URL — clicking it never round-trips through
 * this product's own server again (XPRT-02).
 */
export function ExportMenu({ diagramId, fetchImpl }: ExportMenuProps): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => createExportClient(fetchImpl), [fetchImpl]);

  const [phase, setPhase] = useState<Phase>('idle');
  const [formats, setFormats] = useState<ExportFormats | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const isGenerating = phase === 'generating';

  async function handleGenerate(): Promise<void> {
    if (isGenerating) return;
    setPhase('generating');
    setFormats(null);

    const result = await client.generateExports(diagramId);

    if (result.status === 'ok') {
      setFormats(result.formats);
      setPhase('ready');
      setAnnouncement(t('export.menu.success'));
      return;
    }
    if (result.status === 'rate_limited') {
      setPhase('rate_limited');
      setAnnouncement(t('export.menu.rateLimited'));
      return;
    }
    setPhase('error');
    setAnnouncement(t('export.menu.error'));
  }

  return (
    <details>
      <summary>{t('export.menu.title')}</summary>
      <div aria-live="polite" data-testid="export-menu-announcement">
        {announcement}
      </div>

      <button type="button" onClick={() => void handleGenerate()} disabled={isGenerating}>
        {t('export.menu.generate')}
      </button>

      {phase === 'ready' && formats && (
        <ul>
          {FORMAT_ORDER.map((formatName) => {
            const format = formats[formatName];
            return (
              <li key={formatName}>
                <a href={format.url} target="_blank" rel="noopener noreferrer">
                  {t(FORMAT_LABEL_KEYS[formatName])} ({formatBytes(format.sizeBytes)})
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
