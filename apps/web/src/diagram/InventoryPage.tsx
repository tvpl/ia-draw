import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { InventoryView } from '../library/InventoryView.js';

/**
 * Route: `/w/:workspaceId/d/:diagramId/inventory` — a plain, aggregate reading of a
 * diagram's classified elements (P2: Ver o inventário). Unlike `DiagramEditorPage`, this
 * screen never mounts the canvas (design.md: "a única tela desta fatia que não precisa do
 * canvas montado"), it only wraps `InventoryView` with a way back into the editor.
 */
export function InventoryPage(): JSX.Element {
  const { t } = useTranslation();
  const { workspaceId, diagramId } = useParams<{ workspaceId: string; diagramId: string }>();

  if (!diagramId || !workspaceId) return <p>Missing diagram id.</p>;

  return (
    <div>
      <Link to={`/w/${workspaceId}/d/${diagramId}`}>{t('nav.back')}</Link>
      <InventoryView diagramId={diagramId} />
    </div>
  );
}
