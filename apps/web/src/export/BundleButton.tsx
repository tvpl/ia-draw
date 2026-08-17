import { type JSX, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createExportClient } from './exportClient.js';

export interface BundleButtonProps {
  diagramId: string;
  /** Injectable for tests; defaults to the global fetch (same convention as `AuthProvider`). */
  fetchImpl?: typeof fetch;
  /** Injectable so tests can assert the exact call without a real browser navigation. */
  openUrl?: (url: string) => void;
}

type Phase = 'idle' | 'generating' | 'error';

/**
 * "Download bundle" action for the diagram editor's toolbar (XPRT-05/06) — one diagram's
 * `.zip` per click. Unlike `ExportMenu` (which surfaces links for the user to click),
 * `POST /diagrams/:id/bundle` returns a single signed URL that this button opens itself
 * as soon as the response resolves (XPRT-05's AC: "abrir a url assinada retornada").
 */
export function BundleButton({ diagramId, fetchImpl, openUrl }: BundleButtonProps): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => createExportClient(fetchImpl), [fetchImpl]);
  const doOpen = useMemo(() => openUrl ?? ((url: string) => window.open(url, '_blank')), [openUrl]);

  const [phase, setPhase] = useState<Phase>('idle');
  const [announcement, setAnnouncement] = useState('');

  const isGenerating = phase === 'generating';

  async function handleClick(): Promise<void> {
    if (isGenerating) return;
    setPhase('generating');

    const result = await client.generateBundle(diagramId);

    if (result.status === 'ok') {
      setPhase('idle');
      setAnnouncement(t('export.bundle.success'));
      doOpen(result.url);
      return;
    }
    setPhase('error');
    setAnnouncement(t('export.bundle.error'));
  }

  return (
    <div>
      <div aria-live="polite" data-testid="bundle-button-announcement">
        {announcement}
      </div>
      <button type="button" onClick={() => void handleClick()} disabled={isGenerating}>
        {isGenerating ? t('export.bundle.loading') : t('export.bundle.button')}
      </button>
    </div>
  );
}
