import { type JSX, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface EditorSidePanelProps {
  /** The AI dock, or `null` when bootstrap denies canvas mutation — then the "IA" tab is not offered at all (CMT2-02). */
  aiPanel: ReactNode | null;
  commentsPanel: ReactNode;
}

type TabId = 'ai' | 'comments';

/**
 * The editor's single side column (spec.md, CMT2-01..04): one `tablist` with "IA" and
 * "Comentários", one panel visible at a time.
 *
 * Two panels docked side by side would eat too much of the canvas, which is the object of the
 * product; tabs keep both capabilities reachable without that cost. Both panels stay **mounted**
 * and the inactive one only gets `hidden`: unmounting the AI dock on a tab switch would throw away
 * a run sitting in `awaiting_approval`, which is ephemeral and unrecoverable. `hidden` also takes
 * the inactive panel out of the accessibility tree, so no role query ever finds two submit buttons.
 *
 * The default tab is derived, not captured at mount: `canMutate` only becomes true once bootstrap
 * resolves, so a state initializer would freeze a reviewer's default onto everyone.
 */
export function EditorSidePanel({ aiPanel, commentsPanel }: EditorSidePanelProps): JSX.Element {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<TabId | null>(null);
  const active: TabId = chosen ?? (aiPanel === null ? 'comments' : 'ai');

  return (
    <div>
      <div role="tablist">
        {aiPanel !== null && (
          <button
            type="button"
            role="tab"
            id="side-panel-tab-ai"
            aria-controls="side-panel-ai"
            aria-selected={active === 'ai'}
            onClick={() => setChosen('ai')}
          >
            {t('comments.tabs.ai')}
          </button>
        )}
        <button
          type="button"
          role="tab"
          id="side-panel-tab-comments"
          aria-controls="side-panel-comments"
          aria-selected={active === 'comments'}
          onClick={() => setChosen('comments')}
        >
          {t('comments.tabs.comments')}
        </button>
      </div>

      {aiPanel !== null && (
        <div
          role="tabpanel"
          id="side-panel-ai"
          aria-labelledby="side-panel-tab-ai"
          hidden={active !== 'ai'}
        >
          {aiPanel}
        </div>
      )}
      <div
        role="tabpanel"
        id="side-panel-comments"
        aria-labelledby="side-panel-tab-comments"
        hidden={active !== 'comments'}
      >
        {commentsPanel}
      </div>
    </div>
  );
}
