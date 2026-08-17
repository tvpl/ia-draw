import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import type { SpecDocumentStatus } from './docgenClient.js';
import {
  extractReferencedElementIds,
  parseSpecSections,
  SECTION_NAMES,
  type SectionName,
} from './parseSpecMarkdown.js';

export interface SpecViewerProps {
  /** Already-fetched Markdown text for the version being displayed. */
  markdown: string;
  /** Element ids of the scene this editor session loaded (LDC-06) — same convention/limitation as `CommentsSidebar`'s `liveElementIds`. */
  liveElementIds: readonly string[];
  /** Status of the version being displayed — regenerate controls only ever show for `'current'` (LDC-01/02 of the regenerate story). */
  status: SpecDocumentStatus;
  /** Same `diagram:mutate` boolean every other panel in this codebase receives. */
  canMutate: boolean;
  /** Called with the section name when its "Regenerate this section" control is used — this component never calls `docgenClient` itself (container/display split, same as `HistoryPanel`/`DiffView`). */
  onRegenerateSection: (section: SectionName) => void;
}

/**
 * Pure display for one docgen Markdown document, section by section (spec.md LDC-04..07,
 * LDC-20/21). Never fetches anything itself — `DocsPanel` (T5) owns the content fetch and the
 * `docgenClient` calls; this component only renders what it is given.
 */
export function SpecViewer({
  markdown,
  liveElementIds,
  status,
  canMutate,
  onRegenerateSection,
}: SpecViewerProps): JSX.Element {
  const { t } = useTranslation();
  const sections = parseSpecSections(markdown);
  const canRegenerate = status === 'current' && canMutate;

  return (
    <div>
      {SECTION_NAMES.map((name) => {
        const body = sections[name];
        // LDC-07: `overview` never lists referenced elements — `extractReferencedElementIds`
        // already returns `[]` for it by construction, so no special case is needed here beyond
        // not rendering the (empty) list.
        const referencedIds = name === 'overview' ? [] : extractReferencedElementIds(body);

        return (
          <section key={name} aria-labelledby={`docs-section-${name}`}>
            {/* SPEC_DEVIATION: tasks.md's T4 draft assumed section titles would come straight
                from the server's fixed Portuguese Markdown and so stay untranslated. In practice
                `parseSpecSections` already strips the `## <Título>` heading line out of `body` —
                this `<h3>` is chrome this component renders itself, not fetched prose, so it is
                i18n like every other visible string here (LDC-30). Only the BODY text below stays
                the server's literal Portuguese (spec.md's Out of Scope: the generated document's
                own body is never translated by this slice). */}
            <h3 id={`docs-section-${name}`}>{t(`docs.sections.${name}`)}</h3>
            <p style={{ whiteSpace: 'pre-wrap' }}>{body}</p>

            {referencedIds.length > 0 && (
              <ul data-testid={`docs-section-${name}-references`}>
                {referencedIds.map((elementId) => (
                  <li key={elementId}>
                    {liveElementIds.includes(elementId)
                      ? t('docs.reference.element', { elementId })
                      : t('docs.reference.removed', { elementId })}
                  </li>
                ))}
              </ul>
            )}

            {canRegenerate && (
              <button type="button" onClick={() => onRegenerateSection(name)}>
                {t('docs.regenerateSection')}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}
