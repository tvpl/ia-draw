import { cleanup, render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../i18n/index.js';
import { FrameViewer, type ViewableFrame } from './FrameViewer.js';

expect.extend(toHaveNoViolations);

type AxeResults = Awaited<ReturnType<typeof axe>>;

function seriousOrCriticalViolations(results: AxeResults) {
  return results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

afterEach(cleanup);

const frames: ViewableFrame[] = [
  { id: 'f-1', frameId: 'intro', navLinksJson: [] },
  { id: 'f-2', frameId: 'middle', navLinksJson: [{ targetFrameId: 'f-1' }] },
  { id: 'f-3', frameId: 'end', navLinksJson: [] },
];

describe('FrameViewer accessibility (presentation-mode/T18)', () => {
  it('a frame with nav links has zero serious/critical axe violations', async () => {
    const { container } = render(
      <FrameViewer
        frames={frames}
        currentIndex={1}
        onNavigate={vi.fn()}
        renderCanvas={() => null}
      />,
    );

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('a frame with no nav links has zero serious/critical axe violations', async () => {
    const { container } = render(
      <FrameViewer
        frames={frames}
        currentIndex={0}
        onNavigate={vi.fn()}
        renderCanvas={() => null}
      />,
    );

    const results = await axe(container);
    expect(seriousOrCriticalViolations(results)).toEqual([]);
  });

  it('previous/next and every nav-link button are keyboard-focusable', () => {
    render(
      <FrameViewer
        frames={frames}
        currentIndex={1}
        onNavigate={vi.fn()}
        renderCanvas={() => null}
      />,
    );

    const next = screen.getByRole('button', { name: 'Próximo' });
    next.focus();
    expect(document.activeElement).toBe(next);

    const navLink = screen.getByRole('button', { name: /Ir para:/ });
    navLink.focus();
    expect(document.activeElement).toBe(navLink);
  });
});
