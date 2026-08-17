import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../i18n/index.js';
import { SpecViewer } from './SpecViewer.js';

afterEach(cleanup);

const MARKDOWN = [
  '# Diagram Title',
  '',
  '## Visão Geral',
  '',
  'Este documento descreve o diagrama.',
  '',
  '## Componentes',
  '',
  '- **API** (`api`, tipo: rectangle) — tipo semântico: service',
  '- **DB** (`db`, tipo: rectangle) — tipo semântico: database',
  '',
  '## Fluxos',
  '',
  '- `api` → `db`: lê',
  '',
  '## Decisões',
  '',
  'pergunta aberta',
  '',
].join('\n');

describe('SpecViewer (T4, LDC-04..07, LDC-20/21)', () => {
  it('LDC-04: renders all 4 sections, in fixed order, each under its own title', () => {
    render(
      <SpecViewer
        markdown={MARKDOWN}
        liveElementIds={['api', 'db']}
        status="current"
        canMutate={false}
        onRegenerateSection={vi.fn()}
      />,
    );

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Visão Geral', 'Componentes', 'Fluxos', 'Decisões']);
    expect(screen.getByText('Este documento descreve o diagrama.')).toBeTruthy();
    expect(screen.getByText('pergunta aberta')).toBeTruthy();
  });

  it('LDC-05: Componentes/Fluxos/Decisões list their referenced element ids, in order, no duplicates', () => {
    render(
      <SpecViewer
        markdown={MARKDOWN}
        liveElementIds={['api', 'db']}
        status="current"
        canMutate={false}
        onRegenerateSection={vi.fn()}
      />,
    );

    const componentsRefs = screen.getByTestId('docs-section-components-references');
    expect(
      within(componentsRefs)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Elemento: api', 'Elemento: db']);

    const flowsRefs = screen.getByTestId('docs-section-flows-references');
    expect(
      within(flowsRefs)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Elemento: api', 'Elemento: db']);
  });

  it('LDC-06: an id absent from liveElementIds is shown marked as removed, not hidden', () => {
    render(
      <SpecViewer
        markdown={MARKDOWN}
        liveElementIds={['api']}
        status="current"
        canMutate={false}
        onRegenerateSection={vi.fn()}
      />,
    );

    const componentsRefs = screen.getByTestId('docs-section-components-references');
    expect(within(componentsRefs).getByText('Elemento: api')).toBeTruthy();
    expect(within(componentsRefs).getByText('Elemento removido (db)')).toBeTruthy();
  });

  it('LDC-07: Visão Geral never renders a referenced-elements list', () => {
    render(
      <SpecViewer
        markdown={MARKDOWN}
        liveElementIds={['api', 'db']}
        status="current"
        canMutate={false}
        onRegenerateSection={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('docs-section-overview-references')).toBeNull();
  });

  it('LDC-20: "Regenerar esta seção" appears per section only when status is current and canMutate is true', () => {
    render(
      <SpecViewer
        markdown={MARKDOWN}
        liveElementIds={['api', 'db']}
        status="current"
        canMutate={true}
        onRegenerateSection={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('button', { name: 'Regenerar esta seção' })).toHaveLength(4);
  });

  it('a superseded version shows no regenerate controls, even with canMutate true', () => {
    render(
      <SpecViewer
        markdown={MARKDOWN}
        liveElementIds={['api', 'db']}
        status="superseded"
        canMutate={true}
        onRegenerateSection={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Regenerar esta seção' })).toBeNull();
  });

  it('the current version shows no regenerate controls without canMutate', () => {
    render(
      <SpecViewer
        markdown={MARKDOWN}
        liveElementIds={['api', 'db']}
        status="current"
        canMutate={false}
        onRegenerateSection={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Regenerar esta seção' })).toBeNull();
  });

  it("LDC-21: clicking a section's regenerate button calls onRegenerateSection with that section's name", () => {
    const onRegenerateSection = vi.fn();
    render(
      <SpecViewer
        markdown={MARKDOWN}
        liveElementIds={['api', 'db']}
        status="current"
        canMutate={true}
        onRegenerateSection={onRegenerateSection}
      />,
    );

    const componentsSection = screen.getByText('Componentes').closest('section');
    if (!componentsSection) throw new Error('components section not found');
    fireEvent.click(
      within(componentsSection).getByRole('button', { name: 'Regenerar esta seção' }),
    );

    expect(onRegenerateSection).toHaveBeenCalledTimes(1);
    expect(onRegenerateSection).toHaveBeenCalledWith('components');
  });
});
