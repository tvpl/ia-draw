import { type JSX, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createMetadataClient, type InventoryRow } from './metadataClient.js';

export interface InventoryViewProps {
  diagramId: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

type ViewStatus = 'loading' | 'ready' | 'error';

/**
 * The diagram inventory (CLIB-14..17) — every classified element (`GET
 * /diagrams/:id/inventory`), an element no longer present in the current scene marked
 * visually as removed (never hidden), and a CSV export that reuses the same route
 * (`?format=csv`) and drives the download client-side via `Blob`/`createObjectURL`
 * (design.md Components: "sem subir pelo servidor de novo").
 */
export function InventoryView({ diagramId, fetchImpl }: InventoryViewProps): JSX.Element {
  const { t } = useTranslation();
  const client = useMemo(() => createMetadataClient(fetchImpl), [fetchImpl]);

  const [status, setStatus] = useState<ViewStatus>('loading');
  const [rows, setRows] = useState<InventoryRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    client.inventory(diagramId, 'json').then(
      (loaded) => {
        if (cancelled) return;
        setRows(loaded);
        setStatus('ready');
      },
      () => {
        if (!cancelled) setStatus('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, diagramId]);

  async function handleExportCsv(): Promise<void> {
    const csv = await client.inventory(diagramId, 'csv');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `diagram-${diagramId}-inventory.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h2>{t('inventory.title')}</h2>

      {status === 'loading' && <p>{t('diagram.loading')}</p>}
      {status === 'error' && <p>{t('inventory.error')}</p>}

      {status === 'ready' && (
        <>
          <button type="button" onClick={() => void handleExportCsv()}>
            {t('inventory.exportCsv')}
          </button>

          {rows.length === 0 ? (
            <p>{t('inventory.empty')}</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>{t('inventory.columns.elementId')}</th>
                  <th>{t('inventory.columns.elementType')}</th>
                  <th>{t('inventory.columns.semanticType')}</th>
                  <th>{t('inventory.columns.revision')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.elementId}>
                    <td>{row.elementId}</td>
                    <td>{row.elementType ?? <em>{t('inventory.removed')}</em>}</td>
                    <td>{row.semanticType ?? '—'}</td>
                    <td>{row.revision}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
