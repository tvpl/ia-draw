import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Side-effect import — initializes the shared i18next singleton, same convention as
// shell.a11y.spec.tsx / WorkspaceMembersPage.a11y.spec.tsx. Default language is pt-BR.
import i18n from '../i18n/index.js';
import { CommentsSidebar } from './CommentsSidebar.js';
import type { Comment } from './commentClient.js';

expect.extend(toHaveNoViolations);

// Same rationale/library choice as shell.a11y.spec.tsx (read its header comment for the full
// Knowledge Verification Chain) — duplicated here rather than imported, matching every other
// *.a11y.spec.tsx file's convention in this codebase.
type AxeResults = Awaited<ReturnType<typeof axe>>;

function seriousOrCriticalViolations(results: AxeResults) {
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

afterEach(async () => {
  cleanup();
  // Restores the default locale in case the CMT2-32 test below switched it and failed before
  // switching back, so later tests in this file aren't left asserting the wrong strings.
  await i18n.changeLanguage('pt-BR');
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function comment(id: string, overrides: Partial<Comment> = {}): Comment {
  return {
    id,
    diagramId: 'd-1',
    elementId: null,
    frameId: null,
    parentId: null,
    body: `body of ${id}`,
    status: 'open',
    authorId: 'u-1',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    ...overrides,
  };
}

function populatedFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/diagrams/d-1/comments' && !init) {
      return jsonResponse(200, {
        comments: [
          comment('c-1', { elementId: 'el-1' }),
          comment('c-2', { parentId: 'c-1' }),
          comment('c-3', { status: 'resolved' }),
        ],
      });
    }
    return jsonResponse(200, { comment: comment('c-1', { status: 'resolved' }) });
  });
}

function renderSidebar(fetchImpl: ReturnType<typeof vi.fn>) {
  return render(
    <CommentsSidebar
      diagramId="d-1"
      selection={['el-1']}
      liveElementIds={['el-1']}
      fetchImpl={fetchImpl as unknown as typeof fetch}
    />,
  );
}

describe('CommentsSidebar accessibility (T6, CMT2-30..32)', () => {
  it('the populated open-thread state has zero serious/critical axe violations', async () => {
    const { container } = renderSidebar(populatedFetch());
    await screen.findByText('body of c-1');

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('the resolved-visible state with the reply form open has zero serious/critical axe violations', async () => {
    const { container } = renderSidebar(populatedFetch());
    await screen.findByText('body of c-1');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar resolvidas' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Responder' })[0] as HTMLElement);
    expect(screen.getByTestId('reply-form')).toBeTruthy();

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('every interactive control is keyboard-focusable (CMT2-30)', async () => {
    renderSidebar(populatedFetch());
    await screen.findByText('body of c-1');

    const showResolved = screen.getByRole('checkbox', { name: 'Mostrar resolvidas' });
    showResolved.focus();
    expect(document.activeElement).toBe(showResolved);

    const refresh = screen.getByRole('button', { name: 'Atualizar' });
    refresh.focus();
    expect(document.activeElement).toBe(refresh);

    const thread = screen.getByTestId('comment-thread');
    const resolve = within(thread).getByRole('button', { name: 'Resolver' });
    resolve.focus();
    expect(document.activeElement).toBe(resolve);

    const reply = within(thread).getByRole('button', { name: 'Responder' });
    reply.focus();
    expect(document.activeElement).toBe(reply);

    const composer = screen.getByLabelText('Novo comentário');
    composer.focus();
    expect(document.activeElement).toBe(composer);

    fireEvent.change(composer, { target: { value: 'texto' } });
    const submit = screen.getByRole('button', { name: 'Comentar' });
    submit.focus();
    expect(document.activeElement).toBe(submit);

    fireEvent.click(reply);
    const replyField = screen.getByLabelText('Sua resposta');
    replyField.focus();
    expect(document.activeElement).toBe(replyField);

    fireEvent.change(replyField, { target: { value: 'resposta' } });
    const replySubmit = screen.getByRole('button', { name: 'Enviar resposta' });
    replySubmit.focus();
    expect(document.activeElement).toBe(replySubmit);
  });

  it('the outcome region is aria-live="polite" and announces a completed action (CMT2-31)', async () => {
    renderSidebar(populatedFetch());
    await screen.findByText('body of c-1');

    const liveRegion = screen.getByTestId('comments-announcement');
    expect(liveRegion.getAttribute('aria-live')).toBe('polite');

    const thread = screen.getByTestId('comment-thread');
    fireEvent.click(within(thread).getByRole('button', { name: 'Resolver' }));

    await waitFor(() => expect(liveRegion.textContent).toBe('Comentário resolvido.'));
  });

  it('renders in the en locale as well as pt-BR (CMT2-32)', async () => {
    await i18n.changeLanguage('en');
    renderSidebar(populatedFetch());

    expect(await screen.findByRole('heading', { name: 'Comments' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Show resolved' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    expect(screen.getByLabelText('New comment')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Comment' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Resolve' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Reply' }).length).toBeGreaterThan(0);
    expect(screen.getByText('Anchored to el-1')).toBeTruthy();
  });
});
