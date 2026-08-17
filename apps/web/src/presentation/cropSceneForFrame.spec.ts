import type { SceneElement } from '@arch-canvas/editor-adapter';
import { describe, expect, it } from 'vitest';
import { cropSceneForFrame } from './cropSceneForFrame.js';

function el(id: string, frameId: string | null): SceneElement {
  return { id, frameId } as unknown as SceneElement;
}

describe('cropSceneForFrame (T5, mirrors exportPdf.ts:sceneForFrame)', () => {
  it('matches elements by frameId (isolated from the id-match branch, L-001)', () => {
    const scene = [el('frame-1', null), el('child-a', 'frame-1'), el('outsider', null)];

    const cropped = cropSceneForFrame(scene, { elementId: 'frame-1' });

    expect(cropped.map((e) => e.id).sort()).toEqual(['child-a', 'frame-1']);
  });

  it('matches the frame element itself by id when nothing has that frameId (isolated from the frameId-match branch)', () => {
    const scene = [el('frame-empty', null), el('unrelated', null)];

    const cropped = cropSceneForFrame(scene, { elementId: 'frame-empty' });

    expect(cropped.map((e) => e.id)).toEqual(['frame-empty']);
  });

  it('falls back to the whole scene when elementId matches nothing at all', () => {
    const scene = [el('a', null), el('b', null)];

    const cropped = cropSceneForFrame(scene, { elementId: 'does-not-exist' });

    expect(cropped).toBe(scene);
  });

  it('falls back to the whole scene when elementId is null (logical frame, no geometric extent)', () => {
    const scene = [el('a', null), el('b', null)];

    const cropped = cropSceneForFrame(scene, { elementId: null });

    expect(cropped).toBe(scene);
  });
});
