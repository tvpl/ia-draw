import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/index.js';
import { FrameViewer, type ViewableFrame } from './FrameViewer.js';

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('pt-BR');
});

const frames: ViewableFrame[] = [
  { id: 'f-1', frameId: 'intro', navLinksJson: [] },
  { id: 'f-2', frameId: 'middle', navLinksJson: [{ targetFrameId: 'f-1' }] },
  { id: 'f-3', frameId: 'end', navLinksJson: [] },
];

describe('FrameViewer (T17)', () => {
  it('shows the 1-based position indicator for the current frame', () => {
    render(
      <FrameViewer
        frames={frames}
        currentIndex={1}
        onNavigate={vi.fn()}
        renderCanvas={() => null}
      />,
    );

    expect(screen.getByTestId('frame-viewer-position').textContent).toBe('Frame 2 de 3');
  });

  it('disables "previous" on the first frame and "next" on the last frame', () => {
    const { rerender } = render(
      <FrameViewer
        frames={frames}
        currentIndex={0}
        onNavigate={vi.fn()}
        renderCanvas={() => null}
      />,
    );
    expect((screen.getByRole('button', { name: 'Anterior' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Próximo' }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    rerender(
      <FrameViewer
        frames={frames}
        currentIndex={2}
        onNavigate={vi.fn()}
        renderCanvas={() => null}
      />,
    );
    expect((screen.getByRole('button', { name: 'Próximo' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('clicking "next"/"previous" calls onNavigate with the adjacent index', () => {
    const onNavigate = vi.fn();
    render(
      <FrameViewer
        frames={frames}
        currentIndex={1}
        onNavigate={onNavigate}
        renderCanvas={() => null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(onNavigate).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(onNavigate).toHaveBeenCalledWith(0);
  });

  it('a frame with navLinksJson offers a button per link, labeled with the target frame', () => {
    render(
      <FrameViewer
        frames={frames}
        currentIndex={1}
        onNavigate={vi.fn()}
        renderCanvas={() => null}
      />,
    );

    expect(screen.getByRole('button', { name: 'Ir para: Frame 1 (intro)' })).toBeTruthy();
  });

  it('clicking a nav-link button calls onNavigate with the TARGET index, not the linear next', () => {
    const onNavigate = vi.fn();
    render(
      <FrameViewer
        frames={frames}
        currentIndex={1}
        onNavigate={onNavigate}
        renderCanvas={() => null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ir para: Frame 1 (intro)' }));
    expect(onNavigate).toHaveBeenCalledWith(0);
  });

  it('a frame with no navLinksJson renders no nav-link section at all', () => {
    render(
      <FrameViewer
        frames={frames}
        currentIndex={0}
        onNavigate={vi.fn()}
        renderCanvas={() => null}
      />,
    );

    expect(screen.queryByTestId('frame-viewer-nav-links')).toBeNull();
  });

  it('calls renderCanvas with the CURRENT frame on every render', () => {
    const renderCanvas = vi.fn(() => <div data-testid="canvas-stub" />);
    render(
      <FrameViewer
        frames={frames}
        currentIndex={2}
        onNavigate={vi.fn()}
        renderCanvas={renderCanvas}
      />,
    );

    expect(renderCanvas).toHaveBeenCalledWith(frames[2]);
    expect(screen.getByTestId('canvas-stub')).toBeTruthy();
  });

  it('a single-frame presentation disables both prev and next, but a nav link still works', () => {
    const singleFrame: ViewableFrame[] = [
      { id: 'only', frameId: null, navLinksJson: [{ targetFrameId: 'only' }] },
    ];
    const onNavigate = vi.fn();
    render(
      <FrameViewer
        frames={singleFrame}
        currentIndex={0}
        onNavigate={onNavigate}
        renderCanvas={() => null}
      />,
    );

    expect((screen.getByRole('button', { name: 'Anterior' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Próximo' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: /Ir para:/ }));
    expect(onNavigate).toHaveBeenCalledWith(0);
  });
});
