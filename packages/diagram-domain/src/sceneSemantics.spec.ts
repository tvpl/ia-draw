import type { SceneElement } from '@arch-canvas/editor-adapter';
import { describe, expect, it } from 'vitest';
import { extractSceneSemantics } from './sceneSemantics.js';

/**
 * Minimal, hand-built plain-data scenes — structurally what `restoreElements`
 * would produce, no `@excalidraw/excalidraw` runtime import (AD-008). Cast
 * through `unknown` to `SceneElement`, matching the convention already used
 * in `apps/server/src/modules/ai-engine/buildContext.spec.ts`.
 */
function rect(id: string, extra: Record<string, unknown> = {}): SceneElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    isDeleted: false,
    ...extra,
  } as unknown as SceneElement;
}

function looseText(id: string, text: string): SceneElement {
  return { id, type: 'text', x: 0, y: 0, text, isDeleted: false } as unknown as SceneElement;
}

function boundText(id: string, containerId: string, text: string): SceneElement {
  return {
    id,
    type: 'text',
    x: 0,
    y: 0,
    text,
    containerId,
    isDeleted: false,
  } as unknown as SceneElement;
}

function arrow(
  id: string,
  startBinding: { elementId: string } | null,
  endBinding: { elementId: string } | null,
  extra: Record<string, unknown> = {},
): SceneElement {
  return {
    id,
    type: 'arrow',
    x: 0,
    y: 0,
    isDeleted: false,
    startBinding,
    endBinding,
    ...extra,
  } as unknown as SceneElement;
}

describe('extractSceneSemantics (dependency-free, no @excalidraw/excalidraw at runtime)', () => {
  it('resolves a loose text element label to its own .text', () => {
    const scene = [looseText('t1', 'Hello architecture canvas')];
    const result = extractSceneSemantics(scene);
    expect(result.elements).toEqual([
      { elementId: 't1', type: 'text', label: 'Hello architecture canvas' },
    ]);
  });

  it('resolves a rectangle with a bound text child to the child text', () => {
    const scene = [rect('rect-a'), boundText('label-a', 'rect-a', 'Auth Service')];
    const result = extractSceneSemantics(scene);
    const el = result.elements.find((e) => e.elementId === 'rect-a');
    expect(el?.label).toBe('Auth Service');
  });

  it('gives label null for an element with no associated text at all', () => {
    const scene = [rect('rect-a')];
    const result = extractSceneSemantics(scene);
    expect(result.elements).toEqual([{ elementId: 'rect-a', type: 'rectangle', label: null }]);
  });

  it('resolves an arrow with both bindings to a SemanticEdge, and omits an arrow missing one binding', () => {
    const scene = [
      rect('rect-a'),
      rect('rect-b'),
      arrow('arrow-full', { elementId: 'rect-a' }, { elementId: 'rect-b' }),
      arrow('arrow-partial', { elementId: 'rect-a' }, null),
    ];
    const result = extractSceneSemantics(scene);
    expect(result.edges).toEqual([{ from: 'rect-a', to: 'rect-b', label: null }]);
  });

  it('an arrow edge picks up its own bound-text label', () => {
    const scene = [
      rect('rect-a'),
      rect('rect-b'),
      arrow('arrow-full', { elementId: 'rect-a' }, { elementId: 'rect-b' }),
      boundText('arrow-label', 'arrow-full', 'calls'),
    ];
    const result = extractSceneSemantics(scene);
    expect(result.edges).toEqual([{ from: 'rect-a', to: 'rect-b', label: 'calls' }]);
  });

  it('excludes a deleted element from elements and from any edge referencing it', () => {
    const scene = [
      rect('rect-a'),
      rect('rect-b', { isDeleted: true }),
      arrow('arrow-to-deleted', { elementId: 'rect-a' }, { elementId: 'rect-b' }),
    ];
    const result = extractSceneSemantics(scene);
    // rect-b (isDeleted) is excluded from `elements`; the arrow itself is not
    // deleted, so it still appears as an element, but never as an edge since
    // one of its bindings (rect-b) is no longer a live element.
    expect(result.elements.map((e) => e.elementId).sort()).toEqual(['arrow-to-deleted', 'rect-a']);
    expect(result.edges).toEqual([]);
  });

  it('attaches metadata.semantics when present for the element, omits the field when absent', () => {
    const scene = [rect('rect-a'), rect('rect-b')];
    const result = extractSceneSemantics(scene, [
      { elementId: 'rect-a', semantics: { technology: 'Postgres' } },
    ]);
    const a = result.elements.find((e) => e.elementId === 'rect-a');
    const b = result.elements.find((e) => e.elementId === 'rect-b');
    expect(a).toEqual({
      elementId: 'rect-a',
      type: 'rectangle',
      label: null,
      semantics: { technology: 'Postgres' },
    });
    expect(b).not.toHaveProperty('semantics');
  });

  it('with no metadata argument, no element has a semantics field', () => {
    const scene = [rect('rect-a')];
    const result = extractSceneSemantics(scene);
    expect(result.elements[0]).not.toHaveProperty('semantics');
  });
});
