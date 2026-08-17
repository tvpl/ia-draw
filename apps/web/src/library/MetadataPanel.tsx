import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createMetadataClient, type ElementMetadata } from './metadataClient.js';

export interface MetadataPanelProps {
  diagramId: string;
  /** The canvas's currently-selected element ids (`EditorSurface`'s `onSelectionChange`, same prop shape `AiDock` already receives). Exactly one id shows the metadata form; zero or more than one shows the empty state (CLIB-12, spec.md Components: "seleção múltipla ou vazia cai no mesmo estado"). */
  selection: readonly string[];
  /** `mutatePermissions.allowed`/`diagram:write` — same source `DiagramEditorPage` resolves for `AiDock`/`LibraryPanel`. `false` hides the edit form entirely (CLIB-11) — this panel never learns about a 403 by attempting the write and failing, it already knows not to offer one. */
  canWrite: boolean;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

type PanelStatus = 'empty' | 'loading' | 'ready' | 'error';

/** `'{}'` is the deliberate default for a freshly-selected, not-yet-classified element (CLIB-09: 404 renders a blank-but-valid form, never an error). */
const EMPTY_METADATA_JSON_TEXT = '{}';

/**
 * The semantic-classification panel (CLIB-08..13) — reacts to the canvas selection,
 * fetches/edits one element's metadata, and always reflects the server's own response,
 * never an optimistic local value (CLIB-10). Read-only mode hides the form outright
 * (CLIB-11); switching the selection while the form has unsaved edits silently discards
 * them (CLIB-13) because the form's local state is entirely reset by the effect below,
 * keyed on `selectedElementId`.
 */
export function MetadataPanel({
  diagramId,
  selection,
  canWrite,
  fetchImpl,
}: MetadataPanelProps): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => createMetadataClient(fetchImpl), [fetchImpl]);

  const selectedElementId = selection.length === 1 ? selection[0] : null;

  const [status, setStatus] = useState<PanelStatus>('empty');
  const [semanticType, setSemanticType] = useState('');
  const [metadataJsonText, setMetadataJsonText] = useState(EMPTY_METADATA_JSON_TEXT);
  const [formError, setFormError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const applyServerMetadata = useCallback((metadata: ElementMetadata | null): void => {
    setSemanticType(metadata?.semanticType ?? '');
    setMetadataJsonText(
      metadata ? JSON.stringify(metadata.metadataJson, null, 2) : EMPTY_METADATA_JSON_TEXT,
    );
  }, []);

  useEffect(() => {
    setFormError(null);
    setAnnouncement('');

    if (!selectedElementId) {
      setStatus('empty');
      return;
    }

    let cancelled = false;
    setStatus('loading');
    client.get(diagramId, selectedElementId).then(
      (metadata) => {
        if (cancelled) return;
        applyServerMetadata(metadata);
        setStatus('ready');
      },
      () => {
        if (!cancelled) setStatus('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [diagramId, selectedElementId, client, applyServerMetadata]);

  async function handleSave(): Promise<void> {
    if (!selectedElementId) return;

    let parsedMetadataJson: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(metadataJsonText);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      parsedMetadataJson = parsed as Record<string, unknown>;
    } catch {
      // CLIB edge case: invalid JSON is validated client-side, the route is never called.
      setFormError(t('metadata.invalidJson'));
      return;
    }
    setFormError(null);

    const trimmedSemanticType = semanticType.trim();
    const result = await client.patch(diagramId, selectedElementId, {
      semanticType: trimmedSemanticType.length > 0 ? trimmedSemanticType : null,
      metadataJson: parsedMetadataJson,
    });

    if (result.status === 'ok') {
      applyServerMetadata(result.metadata);
      setAnnouncement(t('metadata.saved'));
    } else {
      setAnnouncement(t('metadata.error'));
    }
  }

  return (
    <div>
      <div aria-live="polite" data-testid="metadata-announcement">
        {announcement}
      </div>

      {status === 'empty' && <p>{t('metadata.emptyState')}</p>}
      {status === 'loading' && <p>{t('diagram.loading')}</p>}
      {status === 'error' && <p>{t('metadata.error')}</p>}

      {status === 'ready' &&
        selectedElementId &&
        (canWrite ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <label>
              {t('metadata.semanticTypeLabel')}
              <input
                value={semanticType}
                onChange={(event) => setSemanticType(event.target.value)}
              />
            </label>
            <label>
              {t('metadata.metadataJsonLabel')}
              <textarea
                value={metadataJsonText}
                onChange={(event) => setMetadataJsonText(event.target.value)}
              />
            </label>
            {formError && <p>{formError}</p>}
            <button type="submit">{t('metadata.save')}</button>
          </form>
        ) : (
          <dl>
            <dt>{t('metadata.semanticTypeLabel')}</dt>
            <dd>{semanticType || '—'}</dd>
            <dt>{t('metadata.metadataJsonLabel')}</dt>
            <dd>{metadataJsonText}</dd>
          </dl>
        ))}
    </div>
  );
}
