import { type JSX, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createExportClient, type ExportFormats, type InteropFormat } from './exportClient.js';

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

/** INT-01/02 (interop-panel, R8): the two DSL export formats, each with its own file
 * extension and button-label i18n key — same shape as `FORMAT_LABEL_KEYS` above, but for
 * `exportDsl` (a single text response, not the 4-format signed-URL batch). */
const DSL_FORMATS: InteropFormat[] = ['mermaid', 'structurizr'];

const DSL_EXTENSION: Record<InteropFormat, string> = {
  mermaid: 'mmd',
  structurizr: 'dsl',
};

const DSL_BUTTON_LABEL_KEYS: Record<InteropFormat, string> = {
  mermaid: 'export.dsl.mermaidButton',
  structurizr: 'export.dsl.structurizrButton',
};

type DslPhase = 'idle' | 'generating' | 'ready' | 'error';

interface DslState {
  phase: DslPhase;
  limitations: string[] | null;
}

const DSL_IDLE_STATE: Record<InteropFormat, DslState> = {
  mermaid: { phase: 'idle', limitations: null },
  structurizr: { phase: 'idle', limitations: null },
};

/** Drives the client-side download for a DSL export's raw text (INT-01/02) — same
 * `Blob`/`URL.createObjectURL` pattern `InventoryView.tsx`'s CSV export already uses; the
 * server returns the text directly, never a signed URL, so there's no link to just open. */
function triggerDslDownload(diagramId: string, format: InteropFormat, dsl: string): void {
  const blob = new Blob([dsl], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `diagram-${diagramId}.${DSL_EXTENSION[format]}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
  // INT-05: each DSL format's own in-flight/ready/error state — independent from `phase`
  // above (the 4-format batch) and from each other.
  const [dslState, setDslState] = useState<Record<InteropFormat, DslState>>(DSL_IDLE_STATE);

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

  /** INT-01/02/03/04/05: a single independent export for one DSL format — one call, then
   * either a client-side download + visible `limitations` (INT-03) or a generic error
   * announced in the same `aria-live` region `handleGenerate` already uses (INT-04). */
  async function handleExportDsl(format: InteropFormat): Promise<void> {
    if (dslState[format].phase === 'generating') return;
    setDslState((prev) => ({ ...prev, [format]: { phase: 'generating', limitations: null } }));

    const result = await client.exportDsl(diagramId, format);

    if (result.status === 'ok') {
      triggerDslDownload(diagramId, format, result.dsl);
      setDslState((prev) => ({
        ...prev,
        [format]: { phase: 'ready', limitations: result.limitations },
      }));
      return;
    }
    setDslState((prev) => ({ ...prev, [format]: { phase: 'error', limitations: null } }));
    setAnnouncement(t('export.dsl.error'));
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

      {DSL_FORMATS.map((format) => {
        const state = dslState[format];
        return (
          <div key={format}>
            <button
              type="button"
              onClick={() => void handleExportDsl(format)}
              disabled={state.phase === 'generating'}
            >
              {t(DSL_BUTTON_LABEL_KEYS[format])}
            </button>
            {state.phase === 'ready' && state.limitations && (
              <div data-testid={`export-dsl-limitations-${format}`}>
                {state.limitations.length > 0 ? (
                  <>
                    {t('export.dsl.limitations')}
                    <ul>
                      {state.limitations.map((limitation) => (
                        <li key={limitation}>{limitation}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p>{t('export.dsl.noLimitations')}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </details>
  );
}
