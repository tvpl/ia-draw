import { allFixtures } from '@arch-canvas/test-fixtures';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorSurface, type EditorSurfaceProps } from './EditorSurface.js';
import type { SceneElement } from './types.js';

// The real `<Excalidraw/>` renders a full interactive canvas (ResizeObserver, real
// DOM measurement, etc.) that jsdom doesn't support and no test in this codebase
// attempts to mount — see `apps/web/src/a11y/shell.a11y.spec.tsx`'s header comment.
// Only the `Excalidraw` export is replaced here; every other export
// (`reconcileElements`, `restoreElements`, ...) stays real, since `applyRemote.ts`
// and `EditorSurface.tsx` itself both call into them.
let capturedOnChange: ((elements: unknown, appState: unknown) => void) | undefined;

vi.mock('@excalidraw/excalidraw', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@excalidraw/excalidraw')>();
  return {
    ...actual,
    Excalidraw: (props: { onChange?: (elements: unknown, appState: unknown) => void }) => {
      capturedOnChange = props.onChange;
      return null;
    },
  };
});

function firstOf(elements: readonly SceneElement[]): SceneElement {
  const [first] = elements;
  if (!first) throw new Error('fixture must have at least one element');
  return first;
}

const base = firstOf(allFixtures.text as readonly SceneElement[]);

describe('EditorSurface (T94, DOCK-03)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    capturedOnChange = undefined;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  function mount(props: EditorSurfaceProps) {
    root = createRoot(container);
    act(() => {
      root.render(<EditorSurface {...props} />);
    });
  }

  it('calls onSelectionChange with the ids whose selectedElementIds[id] is truthy, on every onChange firing', () => {
    const onSelectionChange = vi.fn();
    mount({ onSelectionChange });

    act(() => {
      capturedOnChange?.([], {
        selectedElementIds: { 'el-1': true, 'el-2': false, 'el-3': true },
      });
    });

    expect(onSelectionChange).toHaveBeenCalledWith(['el-1', 'el-3']);
  });

  it('calls onSelectionChange with an empty array when nothing is selected', () => {
    const onSelectionChange = vi.fn();
    mount({ onSelectionChange });

    act(() => {
      capturedOnChange?.([], { selectedElementIds: {} });
    });

    expect(onSelectionChange).toHaveBeenCalledWith([]);
  });

  it('propagates selection even when the change carries no element delta (selection-only change)', () => {
    const onDeltas = vi.fn();
    const onSelectionChange = vi.fn();
    const unchanged: SceneElement = { ...base, version: 1, versionNonce: 1 };
    mount({ initialElements: [unchanged], onDeltas, onSelectionChange });

    act(() => {
      // Same version/versionNonce as initialElements -> computeDiff produces no delta.
      capturedOnChange?.([unchanged], { selectedElementIds: { [unchanged.id]: true } });
    });

    expect(onDeltas).not.toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenCalledWith([unchanged.id]);
  });

  it('regression: onDeltas still fires with the correct upsert delta when an element changes', () => {
    const onDeltas = vi.fn();
    const original: SceneElement = { ...base, version: 1, versionNonce: 1 };
    const changed: SceneElement = { ...base, version: 2, versionNonce: 2 };
    mount({ initialElements: [original], onDeltas });

    act(() => {
      capturedOnChange?.([changed], { selectedElementIds: {} });
    });

    expect(onDeltas).toHaveBeenCalledWith([
      expect.objectContaining({ elementId: changed.id, kind: 'upsert', version: 2 }),
    ]);
  });
});
