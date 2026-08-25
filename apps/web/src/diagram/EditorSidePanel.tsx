import { type JSX, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as css from '../styles/classNames.js';

export interface EditorSidePanelProps {
  /** The AI dock, or `null` when bootstrap denies canvas mutation — then the "IA" tab is not offered at all (CMT2-02). */
  aiPanel: ReactNode | null;
  commentsPanel: ReactNode;
  /** The lint-warnings panel (ALNT-06) — always rendered, never `| null`: `GET /diagrams/:id/lint`
   * only requires `diagram:read`, the same access level that already reaches this page, so unlike
   * `aiPanel` there is no role for which this tab should be withheld. */
  lintPanel: ReactNode;
}

type TabId = 'ai' | 'comments' | 'lint';

/**
 * The editor's single side column (spec.md, CMT2-01..04; ALNT-06 for the third tab): one
 * `tablist` with "IA", "Comentários" and "Lint", one panel visible at a time.
 *
 * Three panels docked side by side would eat too much of the canvas, which is the object of the
 * product; tabs keep every capability reachable without that cost. All three panels stay
 * **mounted** and the inactive ones only get `hidden`: unmounting the AI dock on a tab switch
 * would throw away a run sitting in `awaiting_approval`, which is ephemeral and unrecoverable.
 * `hidden` also takes an inactive panel out of the accessibility tree, so no role query ever
 * finds two submit buttons. `lintPanel`, unlike `aiPanel`, is never `| null` — `GET
 * /diagrams/:id/lint` only requires `diagram:read` (ALNT-06), the same access level every role
 * that reaches this page already has, so the "Lint" tab has no gated-off case to represent.
 *
 * The default tab is derived, not captured at mount: `canMutate` only becomes true once bootstrap
 * resolves, so a state initializer would freeze a reviewer's default onto everyone.
 */
export function EditorSidePanel({
  aiPanel,
  commentsPanel,
  lintPanel,
}: EditorSidePanelProps): JSX.Element {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<TabId | null>(null);
  const active: TabId = chosen ?? (aiPanel === null ? 'comments' : 'ai');

  // UIF-16: one tab treatment for all three, with the selected one carrying the accent.
  const tabClass = (selected: boolean) =>
    `${css.buttonQuiet} rounded-none border-b-2 ${
      selected ? 'border-accent text-content' : 'border-transparent'
    }`;

  return (
    <div className="flex flex-col rounded-panel border border-border">
      <div className="flex flex-row border-b border-border" role="tablist">
        {aiPanel !== null && (
          <button
            className={tabClass(active === 'ai')}
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
          className={tabClass(active === 'comments')}
          type="button"
          role="tab"
          id="side-panel-tab-comments"
          aria-controls="side-panel-comments"
          aria-selected={active === 'comments'}
          onClick={() => setChosen('comments')}
        >
          {t('comments.tabs.comments')}
        </button>
        <button
          className={tabClass(active === 'lint')}
          type="button"
          role="tab"
          id="side-panel-tab-lint"
          aria-controls="side-panel-lint"
          aria-selected={active === 'lint'}
          onClick={() => setChosen('lint')}
        >
          {t('comments.tabs.lint')}
        </button>
      </div>

      {aiPanel !== null && (
        <div
          className="p-3"
          role="tabpanel"
          id="side-panel-ai"
          aria-labelledby="side-panel-tab-ai"
          hidden={active !== 'ai'}
        >
          {aiPanel}
        </div>
      )}
      <div
        className="p-3"
        role="tabpanel"
        id="side-panel-comments"
        aria-labelledby="side-panel-tab-comments"
        hidden={active !== 'comments'}
      >
        {commentsPanel}
      </div>
      <div
        className="p-3"
        role="tabpanel"
        id="side-panel-lint"
        aria-labelledby="side-panel-tab-lint"
        hidden={active !== 'lint'}
      >
        {lintPanel}
      </div>
    </div>
  );
}
