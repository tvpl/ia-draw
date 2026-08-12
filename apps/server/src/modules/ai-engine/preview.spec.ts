import type { AbstractPatch } from '@arch-canvas/ai-tools';
import type { SceneElement } from '@arch-canvas/editor-adapter';
import { describe, expect, it } from 'vitest';
import { buildPreviewSummary, computeApprovalThreshold } from './preview.js';

function el(id: string, extra: Record<string, unknown> = {}): SceneElement {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    ...extra,
  } as unknown as SceneElement;
}

function upsert(elementId: string, extra: Record<string, unknown> = {}) {
  return {
    op: 'upsertElement' as const,
    elementId,
    element: { ...el(elementId, extra) } as Record<string, unknown>,
  };
}

function del(elementId: string) {
  return { op: 'deleteElement' as const, elementId };
}

describe('computeApprovalThreshold (T54, AIE-02 literal rule)', () => {
  it('a patch with one removal requires explicit approval', () => {
    const scene = [el('a'), el('b')];
    const patch: AbstractPatch = { operations: [del('a')] };
    const result = computeApprovalThreshold({ patch, currentScene: scene, selection: [] });
    expect(result.requiresExplicitApproval).toBe(true);
    expect(result.reasons).toContain('removal');
  });

  it('a patch touching exactly 50 elements does NOT require explicit approval (boundary)', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `el-${i}`);
    const scene = ids.map((id) => el(id));
    const patch: AbstractPatch = { operations: ids.map((id) => upsert(id)) };
    const result = computeApprovalThreshold({ patch, currentScene: scene, selection: [] });
    expect(result.touchedElementCount).toBe(50);
    expect(result.requiresExplicitApproval).toBe(false);
    expect(result.reasons).not.toContain('element_count');
  });

  it('a patch touching 51 elements DOES require explicit approval (boundary)', () => {
    const ids = Array.from({ length: 51 }, (_, i) => `el-${i}`);
    const scene = ids.map((id) => el(id));
    const patch: AbstractPatch = { operations: ids.map((id) => upsert(id)) };
    const result = computeApprovalThreshold({ patch, currentScene: scene, selection: [] });
    expect(result.touchedElementCount).toBe(51);
    expect(result.requiresExplicitApproval).toBe(true);
    expect(result.reasons).toContain('element_count');
  });

  it('a patch modifying a pre-existing element outside the declared selection requires explicit approval', () => {
    const scene = [el('a'), el('b')];
    const patch: AbstractPatch = { operations: [upsert('b', { x: 99 })] };
    const result = computeApprovalThreshold({ patch, currentScene: scene, selection: ['a'] });
    expect(result.requiresExplicitApproval).toBe(true);
    expect(result.reasons).toContain('outside_selection');
  });

  it('a patch that only touches the declared selection does not require explicit approval', () => {
    const scene = [el('a'), el('b')];
    const patch: AbstractPatch = { operations: [upsert('a', { x: 99 })] };
    const result = computeApprovalThreshold({ patch, currentScene: scene, selection: ['a'] });
    expect(result.requiresExplicitApproval).toBe(false);
  });

  it('creating a brand-new element (not in the current scene) never counts as outside-selection', () => {
    const scene = [el('a')];
    const patch: AbstractPatch = { operations: [upsert('brand-new')] };
    const result = computeApprovalThreshold({ patch, currentScene: scene, selection: ['a'] });
    expect(result.requiresExplicitApproval).toBe(false);
  });

  it('no selection declared means the outside-selection rule never triggers', () => {
    const scene = [el('a'), el('b')];
    const patch: AbstractPatch = { operations: [upsert('b', { x: 99 })] };
    const result = computeApprovalThreshold({ patch, currentScene: scene, selection: [] });
    expect(result.requiresExplicitApproval).toBe(false);
  });
});

describe('buildPreviewSummary (T54)', () => {
  it('categorizes added/removed/modified/metadataChanged without mutating its inputs', () => {
    const scene = [el('kept'), el('to-remove'), el('to-modify')];
    const sceneCopy = JSON.parse(JSON.stringify(scene));
    const patch: AbstractPatch = {
      operations: [
        upsert('brand-new'),
        del('to-remove'),
        upsert('to-modify', { backgroundColor: '#ff0000' }),
        { op: 'setMetadata', elementId: 'kept', metadata: { technology: 'postgres' } },
      ],
    };

    const summary = buildPreviewSummary(scene, patch);

    expect(summary.added).toEqual(['brand-new']);
    expect(summary.removed).toEqual(['to-remove']);
    expect(summary.modified).toEqual(['to-modify']);
    expect(summary.metadataChanged).toEqual(['kept']);
    expect(scene).toEqual(sceneCopy);
  });
});
