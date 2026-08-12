import { extractSceneSemantics } from '@arch-canvas/diagram-domain';
import type { SceneElement } from '@arch-canvas/editor-adapter';
import { describe, expect, it } from 'vitest';
import type { ElementMetadataRow } from '../library/metadata.js';
import { lintDiagram } from './engine.js';

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

function frame(id: string): SceneElement {
  return { id, type: 'frame', x: 0, y: 0, isDeleted: false } as unknown as SceneElement;
}

function looseText(id: string, text: string): SceneElement {
  return { id, type: 'text', x: 0, y: 0, text, isDeleted: false } as unknown as SceneElement;
}

function arrow(
  id: string,
  startBinding: { elementId: string } | null,
  endBinding: { elementId: string } | null,
): SceneElement {
  return {
    id,
    type: 'arrow',
    x: 0,
    y: 0,
    isDeleted: false,
    startBinding,
    endBinding,
  } as unknown as SceneElement;
}

function meta(
  elementId: string,
  fields: { semanticType?: string | null; metadataJson?: Record<string, unknown> },
): ElementMetadataRow {
  return {
    diagramId: 'd1',
    elementId,
    semanticType: fields.semanticType ?? null,
    metadataJson: fields.metadataJson ?? {},
    revision: 1,
  };
}

function run(
  scene: SceneElement[],
  metaRows: ElementMetadataRow[] = [],
  workspaceRules?: Parameters<typeof lintDiagram>[3],
) {
  const metadataInputs = metaRows.map((row) => ({
    elementId: row.elementId,
    semantics: {
      ...(row.semanticType !== null ? { semanticType: row.semanticType } : {}),
      ...(typeof row.metadataJson === 'object' && row.metadataJson !== null
        ? row.metadataJson
        : {}),
    },
  }));
  const semantics = extractSceneSemantics(scene, metadataInputs);
  return lintDiagram(scene, semantics, metaRows, workspaceRules);
}

describe('lintDiagram — LNT-01 (structural/architectural warnings)', () => {
  it('flags an orphan component AND a connector without protocol in the same run, function stays pure (no side effects on inputs)', () => {
    const scene = [
      rect('lonely'),
      rect('a'),
      rect('b'),
      arrow('conn', { elementId: 'a' }, { elementId: 'b' }),
    ];
    const before = JSON.parse(JSON.stringify(scene.map((el) => (el as { id: string }).id)));
    const warnings = run(scene);

    expect(
      warnings.some((w) => w.rule === 'orphan-component' && w.elementIds.includes('lonely')),
    ).toBe(true);
    expect(
      warnings.some((w) => w.rule === 'connector-no-protocol' && w.elementIds.includes('conn')),
    ).toBe(true);
    // Purity: scene identity/order untouched.
    expect(scene.map((el) => (el as { id: string }).id)).toEqual(before);
    for (const w of warnings) expect(w.severity).toBe('warning');
  });

  it('a connector WITH protocol metadata is not flagged', () => {
    const scene = [rect('a'), rect('b'), arrow('conn', { elementId: 'a' }, { elementId: 'b' })];
    const warnings = run(scene, [meta('conn', { metadataJson: { protocol: 'HTTPS' } })]);
    expect(warnings.some((w) => w.rule === 'connector-no-protocol')).toBe(false);
  });

  it('flags an arrow with an unresolved binding as unclear-direction', () => {
    const scene = [rect('a'), arrow('dangling', { elementId: 'a' }, null)];
    const warnings = run(scene);
    expect(warnings.find((w) => w.rule === 'unclear-direction')?.elementIds).toContain('dangling');
    // A dangling arrow is not double-counted as missing a protocol too.
    expect(warnings.some((w) => w.rule === 'connector-no-protocol')).toBe(false);
  });

  it('a secret-looking label is flagged by the secret-in-label heuristic', () => {
    const scene = [looseText('t1', 'API_KEY=xyz123'), rect('normal')];
    const warnings = run(scene);
    expect(warnings.find((w) => w.rule === 'secret-in-label')?.elementIds).toContain('t1');
  });

  it('more than one sensitive component outside a trust boundary triggers missing-trust-boundary; being inside one does not', () => {
    const boundary = frame('tb1');
    const scene = [
      boundary,
      rect('outside1', { frameId: null }),
      rect('outside2', { frameId: null }),
      rect('inside', { frameId: 'tb1' }),
    ];
    const metaRows = [
      meta('tb1', { semanticType: 'trustBoundary' }),
      meta('outside1', { metadataJson: { dataClassification: 'pii' } }),
      meta('outside2', { metadataJson: { dataClassification: 'secret' } }),
      meta('inside', { metadataJson: { dataClassification: 'pii' } }),
    ];
    const warnings = run(scene, metaRows);
    const warning = warnings.find((w) => w.rule === 'missing-trust-boundary');
    expect(warning?.elementIds).toEqual(expect.arrayContaining(['outside1', 'outside2']));
    expect(warning?.elementIds).not.toContain('inside');
  });

  it('two components in different environments connected directly (no boundary) trigger mixed-environments', () => {
    const scene = [
      rect('prod-svc'),
      rect('staging-svc'),
      arrow('conn', { elementId: 'prod-svc' }, { elementId: 'staging-svc' }),
    ];
    const metaRows = [
      meta('prod-svc', { metadataJson: { environment: 'production', protocol: 'HTTPS' } }),
      meta('staging-svc', { metadataJson: { environment: 'staging' } }),
      meta('conn', { metadataJson: { protocol: 'HTTPS' } }),
    ];
    const warnings = run(scene, metaRows);
    expect(warnings.find((w) => w.rule === 'mixed-environments')?.elementIds).toEqual(
      expect.arrayContaining(['prod-svc', 'staging-svc']),
    );
  });

  it('a component with >1 incoming edge and no redundant peer of the same semantic type is flagged as a possible SPOF', () => {
    const scene = [
      rect('gateway'),
      rect('svc-a'),
      rect('svc-b'),
      arrow('e1', { elementId: 'svc-a' }, { elementId: 'gateway' }),
      arrow('e2', { elementId: 'svc-b' }, { elementId: 'gateway' }),
    ];
    const metaRows = [meta('gateway', { semanticType: 'gateway' })];
    const warnings = run(scene, metaRows);
    expect(warnings.find((w) => w.rule === 'spof')?.elementIds).toContain('gateway');
  });

  it('a redundant peer of the same semantic type suppresses the SPOF warning', () => {
    const scene = [
      rect('gateway-1'),
      rect('gateway-2'),
      rect('svc-a'),
      arrow('e1', { elementId: 'svc-a' }, { elementId: 'gateway-1' }),
      arrow('e2', { elementId: 'svc-a' }, { elementId: 'gateway-1' }),
    ];
    const metaRows = [
      meta('gateway-1', { semanticType: 'gateway' }),
      meta('gateway-2', { semanticType: 'gateway' }),
    ];
    const warnings = run(scene, metaRows);
    expect(warnings.some((w) => w.rule === 'spof')).toBe(false);
  });
});

describe('lintDiagram — LNT-02 (soft C4-level validation)', () => {
  it('an element with Component-level detail inside a Context-level diagram is a soft warning, not an error', () => {
    const scene = [rect('ctx'), rect('detail')];
    const metaRows = [
      meta('ctx', { metadataJson: { c4Level: 'context' } }),
      meta('detail', { metadataJson: { c4Level: 'component' } }),
    ];
    const warnings = run(scene, metaRows);
    const warning = warnings.find((w) => w.rule === 'c4-level-mismatch');
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe('warning');
    expect(warning?.elementIds).toContain('detail');
  });

  it('a diagram with only Context and Container levels (adjacent) does not trigger the mismatch', () => {
    const scene = [rect('ctx'), rect('cnt')];
    const metaRows = [
      meta('ctx', { metadataJson: { c4Level: 'context' } }),
      meta('cnt', { metadataJson: { c4Level: 'container' } }),
    ];
    const warnings = run(scene, metaRows);
    expect(warnings.some((w) => w.rule === 'c4-level-mismatch')).toBe(false);
  });
});

describe('lintDiagram — LNT-03 (per-workspace rule overrides)', () => {
  it('disabling the SPOF rule removes only that warning, other rules stay active', () => {
    const scene = [
      rect('lonely'),
      rect('gateway'),
      rect('svc-a'),
      rect('svc-b'),
      arrow('e1', { elementId: 'svc-a' }, { elementId: 'gateway' }),
      arrow('e2', { elementId: 'svc-b' }, { elementId: 'gateway' }),
    ];
    const withoutOverride = run(scene, [meta('gateway', { semanticType: 'gateway' })]);
    expect(withoutOverride.some((w) => w.rule === 'spof')).toBe(true);
    expect(withoutOverride.some((w) => w.rule === 'orphan-component')).toBe(true);

    const withOverride = run(scene, [meta('gateway', { semanticType: 'gateway' })], {
      spof: false,
    });
    expect(withOverride.some((w) => w.rule === 'spof')).toBe(false);
    expect(withOverride.some((w) => w.rule === 'orphan-component')).toBe(true);
  });
});
