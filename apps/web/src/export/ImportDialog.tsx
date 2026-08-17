import { type ChangeEvent, type FormEvent, type JSX, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { createExportClient, type ImportPreview, type InteropFormat } from './exportClient.js';

export interface ImportDialogProps {
  projectId: string;
  workspaceId: string;
  /** XPRT-12: the trigger is entirely absent when the caller's role lacks `diagram:write`. */
  canImport: boolean;
  /** Injectable for tests; defaults to the global fetch (same convention as `AuthProvider`). */
  fetchImpl?: typeof fetch;
}

/** INT-06 (interop-panel, R8): the format selector's three options — `.excalidraw` is the
 * pre-existing R7 flow (preview-then-confirm via the server), `mermaid`/`structurizr` are
 * new (client-side preview only, direct-create confirm — spec.md's Assumptions table). */
type ImportFormat = 'excalidraw' | InteropFormat;

const DSL_FORMATS: InteropFormat[] = ['mermaid', 'structurizr'];

const FORMAT_LABEL_KEYS: Record<ImportFormat, string> = {
  excalidraw: 'import.format.excalidraw',
  mermaid: 'import.format.mermaid',
  structurizr: 'import.format.structurizr',
};

/** INT-07: `accept` hint per format — content is still what's actually validated (never the
 * extension), same principle as the pre-existing `.excalidraw` Edge Case in spec.md. */
const DSL_FILE_ACCEPT: Record<InteropFormat, string> = {
  mermaid: '.mmd,.txt',
  structurizr: '.dsl,.txt',
};

type Phase = 'idle' | 'previewing' | 'previewed' | 'invalid' | 'error' | 'confirming';

/**
 * File-select -> preview -> confirm -> navigate flow for importing a `.excalidraw` file into
 * a project (XPRT-07..12). Same native `<dialog>` pattern as `ConfirmArchiveDialog` (T3/R3),
 * opened/closed imperatively via a ref. The file is read as plain text via `File.text()` and
 * sent raw as `fileContent` — the server parses it directly, never base64/multipart
 * (spec.md's Assumptions table). Validation is by content, never by file extension (spec.md
 * Edge Cases): whatever `previewImport` accepts is accepted.
 *
 * INT-06..17 (interop-panel, R8): the same dialog also imports Mermaid/Structurizr DSL,
 * selected via a `<fieldset>` format radiogroup (`.excalidraw` default). Those two formats
 * have no server preview route — `handleFileChange` sets `previewed` from the raw text alone
 * (INT-08) — and `handleConfirmDsl` creates the diagram directly via `importDsl` (no
 * preview-then-confirm), with an optional title (INT-14) unlike `.excalidraw`'s required one.
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

  const [format, setFormat] = useState<ImportFormat>('excalidraw');
  const [phase, setPhase] = useState<Phase>('idle');
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [announcement, setAnnouncement] = useState('');

  function resetState(): void {
    setFormat('excalidraw');
    setPhase('idle');
    setFileContent(null);
    setPreview(null);
    setMessage(null);
    setTitle('');
  }

  /** INT-07: switching format discards any previously selected file/preview — never lets a
   * file read under one format get submitted under another. */
  function handleFormatChange(next: ImportFormat): void {
    setFormat(next);
    setPhase('idle');
    setFileContent(null);
    setPreview(null);
    setMessage(null);
    setTitle('');
  }

  /** INT-10: the aria-live text for a successful DSL import — always mentions `limitations`,
   * even when empty (spec.md AC5), since the dialog closes and navigates right after, so the
   * announcement is the only place a screen-reader user sees them. */
  function dslSuccessAnnouncement(limitations: string[]): string {
    const base = t('import.success');
    if (limitations.length === 0) return `${base} — ${t('import.noLimitations')}`;
    return `${base} — ${t('import.limitations')} ${limitations.join('; ')}`;
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
    setPreview(null);
    setMessage(null);

    if (format !== 'excalidraw') {
      // INT-08: no dry-run route exists for Mermaid/Structurizr — the preview is purely
      // client-side (the text just read), with no server round-trip at this step.
      setPhase('previewed');
      return;
    }

    setPhase('previewing');
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

  async function handleConfirmExcalidraw(): Promise<void> {
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

  async function handleConfirmDsl(dslFormat: InteropFormat): Promise<void> {
    // INT-13: a zero-length file never emits the confirmation request either.
    if (!fileContent) return;

    setPhase('confirming');
    const trimmedTitle = title.trim();
    // INT-14: title is optional for Mermaid/Structurizr — omitted entirely when blank, letting
    // the server apply its own per-format default (importDsl.ts's `defaultTitle`).
    const result = await client.importDsl(
      projectId,
      dslFormat,
      fileContent,
      trimmedTitle || undefined,
    );

    if (result.status === 'ok') {
      setAnnouncement(dslSuccessAnnouncement(result.limitations));
      closeDialog();
      navigate(`/w/${workspaceId}/d/${result.diagramId}`);
      return;
    }
    if (result.status === 'invalid') {
      setMessage(result.message);
      setAnnouncement(result.message);
      setPhase('invalid');
      return;
    }
    setMessage(t('nav.error.generic'));
    setAnnouncement(t('nav.error.generic'));
    setPhase('error');
  }

  async function handleConfirm(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (format === 'excalidraw') {
      await handleConfirmExcalidraw();
      return;
    }
    await handleConfirmDsl(format);
  }

  if (!canImport) return null;

  // INT-09/13/14: Mermaid/Structurizr never require a title (server default applies); they
  // only require non-empty file content. `.excalidraw` keeps its existing title-required rule.
  const canConfirm =
    phase === 'previewed' &&
    (format === 'excalidraw' ? title.trim().length > 0 : (fileContent?.length ?? 0) > 0);

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

        {/* INT-06/07: format selector — `.excalidraw` selected by default (R7 behavior
            unchanged); switching format discards any previously read file/preview. */}
        <fieldset>
          <legend>{t('import.format.label')}</legend>
          {(['excalidraw', ...DSL_FORMATS] as ImportFormat[]).map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="import-format"
                value={option}
                checked={format === option}
                onChange={() => handleFormatChange(option)}
              />
              {t(FORMAT_LABEL_KEYS[option])}
            </label>
          ))}
        </fieldset>

        <label>
          {format === 'excalidraw' ? t('import.fileLabel') : t('import.dslFileLabel')}
          <input
            key={format}
            type="file"
            accept={format === 'excalidraw' ? '.excalidraw' : DSL_FILE_ACCEPT[format]}
            onChange={(event) => void handleFileChange(event)}
          />
        </label>

        {(phase === 'invalid' || phase === 'error') && message && <p role="alert">{message}</p>}

        {format === 'excalidraw' && preview && phase === 'previewed' && (
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

        {format !== 'excalidraw' && fileContent !== null && phase === 'previewed' && (
          <>
            <label>
              {t('import.dslPreviewLabel')}
              <textarea readOnly value={fileContent} />
            </label>
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
