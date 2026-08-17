import { type ChangeEvent, type FormEvent, type JSX, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { createExportClient, type ImportPreview } from './exportClient.js';

export interface ImportDialogProps {
  projectId: string;
  workspaceId: string;
  /** XPRT-12: the trigger is entirely absent when the caller's role lacks `diagram:write`. */
  canImport: boolean;
  /** Injectable for tests; defaults to the global fetch (same convention as `AuthProvider`). */
  fetchImpl?: typeof fetch;
}

type Phase = 'idle' | 'previewing' | 'previewed' | 'invalid' | 'error' | 'confirming';

/**
 * File-select -> preview -> confirm -> navigate flow for importing a `.excalidraw` file into
 * a project (XPRT-07..12). Same native `<dialog>` pattern as `ConfirmArchiveDialog` (T3/R3),
 * opened/closed imperatively via a ref. The file is read as plain text via `File.text()` and
 * sent raw as `fileContent` — the server parses it directly, never base64/multipart
 * (spec.md's Assumptions table). Validation is by content, never by file extension (spec.md
 * Edge Cases): whatever `previewImport` accepts is accepted.
 */
export function ImportDialog({
  projectId,
  workspaceId,
  canImport,
  fetchImpl,
}: ImportDialogProps): JSX.Element | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const client = useMemo(() => createExportClient(fetchImpl), [fetchImpl]);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [announcement, setAnnouncement] = useState('');

  function resetState(): void {
    setPhase('idle');
    setFileContent(null);
    setPreview(null);
    setMessage(null);
    setTitle('');
  }

  function openDialog(): void {
    resetState();
    dialogRef.current?.showModal();
  }

  function closeDialog(): void {
    dialogRef.current?.close();
    resetState();
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;

    const content = await file.text();
    setFileContent(content);
    setPhase('previewing');
    setPreview(null);
    setMessage(null);

    const result = await client.previewImport(projectId, content);

    if (result.status === 'ok') {
      setPreview(result.preview);
      setPhase('previewed');
      return;
    }
    if (result.status === 'invalid') {
      setMessage(result.message);
      setPhase('invalid');
      return;
    }
    setMessage(t('nav.error.generic'));
    setPhase('error');
  }

  async function handleConfirm(event: FormEvent): Promise<void> {
    event.preventDefault();
    // XPRT-11: an empty title never emits the confirmation request.
    const trimmedTitle = title.trim();
    if (!trimmedTitle || !fileContent) return;

    setPhase('confirming');
    const result = await client.confirmImport(projectId, fileContent, trimmedTitle);

    if (result.status === 'ok') {
      setAnnouncement(t('import.success'));
      closeDialog();
      navigate(`/w/${workspaceId}/d/${result.diagram.id}`);
      return;
    }
    if (result.status === 'invalid') {
      // XPRT-17: a confirmation that fails is announced too, not just a successful one.
      setMessage(result.message);
      setAnnouncement(result.message);
      setPhase('invalid');
      return;
    }
    setMessage(t('nav.error.generic'));
    setAnnouncement(t('nav.error.generic'));
    setPhase('error');
  }

  if (!canImport) return null;

  const canConfirm = phase === 'previewed' && title.trim().length > 0;

  return (
    <>
      <div aria-live="polite" data-testid="import-announcement">
        {announcement}
      </div>
      <button type="button" onClick={openDialog}>
        {t('import.trigger')}
      </button>

      <dialog ref={dialogRef} aria-labelledby="import-dialog-title" onCancel={closeDialog}>
        <h2 id="import-dialog-title">{t('import.title')}</h2>

        <label>
          {t('import.fileLabel')}
          <input
            type="file"
            accept=".excalidraw"
            onChange={(event) => void handleFileChange(event)}
          />
        </label>

        {(phase === 'invalid' || phase === 'error') && message && <p role="alert">{message}</p>}

        {preview && phase === 'previewed' && (
          <>
            <p>{t('import.preview', { count: preview.elementCount })}</p>
            <form onSubmit={(event) => void handleConfirm(event)}>
              <label>
                {t('import.titleLabel')}
                <input value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <button type="submit" disabled={!canConfirm}>
                {t('import.confirm')}
              </button>
            </form>
          </>
        )}

        <button type="button" onClick={closeDialog}>
          {t('import.cancel')}
        </button>
      </dialog>
    </>
  );
}
