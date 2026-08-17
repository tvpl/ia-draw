import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
// Side-effect import — initializes the shared i18next singleton. Default language is pt-BR.
import '../i18n/index.js';
import { EditorSidePanel } from './EditorSidePanel.js';

afterEach(() => {
  cleanup();
});

const aiSlot = (
  <button type="button" data-testid="ai-slot">
    ação da IA
  </button>
);
const commentsSlot = (
  <button type="button" data-testid="comments-slot">
    ação de comentário
  </button>
);
const lintSlot = (
  <button type="button" data-testid="lint-slot">
    ação de lint
  </button>
);

describe('EditorSidePanel — with the AI dock available (CMT2-01, CMT2-04, ALNT-06)', () => {
  it('renders a tablist with all three tabs (CMT2-01, ALNT-06)', () => {
    render(<EditorSidePanel aiPanel={aiSlot} commentsPanel={commentsSlot} lintPanel={lintSlot} />);

    expect(screen.getByRole('tablist')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'IA' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Comentários' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Lint' })).toBeTruthy();
  });

  it('opens on the AI tab (CMT2-04)', () => {
    render(<EditorSidePanel aiPanel={aiSlot} commentsPanel={commentsSlot} lintPanel={lintSlot} />);

    expect(screen.getByRole('tab', { name: 'IA' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Comentários' }).getAttribute('aria-selected')).toBe(
      'false',
    );
    expect(screen.getByRole('button', { name: 'ação da IA' })).toBeTruthy();
  });

  it('shows exactly one panel at a time, keeping the inactive one mounted but out of the accessibility tree (CMT2-01)', () => {
    const { container } = render(
      <EditorSidePanel aiPanel={aiSlot} commentsPanel={commentsSlot} lintPanel={lintSlot} />,
    );

    expect(container.querySelector('#side-panel-ai')?.hasAttribute('hidden')).toBe(false);
    expect(container.querySelector('#side-panel-comments')?.hasAttribute('hidden')).toBe(true);
    // Still in the DOM (state preserved), just not reachable by role.
    expect(container.querySelector('[data-testid="comments-slot"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'ação de comentário' })).toBeNull();
  });

  it('switches panels on tab activation without unmounting the one left behind (CMT2-01)', () => {
    const { container } = render(
      <EditorSidePanel aiPanel={aiSlot} commentsPanel={commentsSlot} lintPanel={lintSlot} />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Comentários' }));

    expect(screen.getByRole('tab', { name: 'Comentários' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'ação de comentário' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'ação da IA' })).toBeNull();
    expect(container.querySelector('[data-testid="ai-slot"]')).not.toBeNull();
  });

  it('the Lint tab is always present and switching to it never unmounts the ones left behind (ALNT-06)', () => {
    const { container } = render(
      <EditorSidePanel aiPanel={aiSlot} commentsPanel={commentsSlot} lintPanel={lintSlot} />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Lint' }));

    expect(screen.getByRole('tab', { name: 'Lint' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'ação de lint' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'ação da IA' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'ação de comentário' })).toBeNull();
    expect(container.querySelector('[data-testid="ai-slot"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="comments-slot"]')).not.toBeNull();
  });
});

describe('EditorSidePanel — without the AI dock (CMT2-02, CMT2-03, ALNT-06)', () => {
  it('omits the AI tab entirely but keeps both Comentários and Lint (CMT2-02, ALNT-06)', () => {
    const { container } = render(
      <EditorSidePanel aiPanel={null} commentsPanel={commentsSlot} lintPanel={lintSlot} />,
    );

    expect(screen.queryByRole('tab', { name: 'IA' })).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Lint' })).toBeTruthy();
    expect(container.querySelector('#side-panel-ai')).toBeNull();
  });

  it('opens on the comments panel (CMT2-03)', () => {
    const { container } = render(
      <EditorSidePanel aiPanel={null} commentsPanel={commentsSlot} lintPanel={lintSlot} />,
    );

    expect(screen.getByRole('tab', { name: 'Comentários' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(container.querySelector('#side-panel-comments')?.hasAttribute('hidden')).toBe(false);
    expect(screen.getByRole('button', { name: 'ação de comentário' })).toBeTruthy();
  });

  it('still opens on the AI tab once the dock becomes available after bootstrap resolves (CMT2-04)', () => {
    const { rerender } = render(
      <EditorSidePanel aiPanel={null} commentsPanel={commentsSlot} lintPanel={lintSlot} />,
    );

    rerender(
      <EditorSidePanel aiPanel={aiSlot} commentsPanel={commentsSlot} lintPanel={lintSlot} />,
    );

    expect(screen.getByRole('tab', { name: 'IA' }).getAttribute('aria-selected')).toBe('true');
  });
});
