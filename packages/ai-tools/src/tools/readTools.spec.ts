import { LIBRARY_MANIFEST } from '@arch-canvas/library-content';
import { arrowWithBindingsFixture, textFixture } from '@arch-canvas/test-fixtures';
import { describe, expect, it } from 'vitest';
import {
  getLibraryComponentTool,
  getNeighborsTool,
  getSelectionTool,
  inspectDiagramTool,
  searchElementsTool,
  searchLibraryTool,
} from './readTools.js';
import { createDefaultToolRegistry } from './registry.js';
import type { ToolContext } from './types.js';

const LIBRARY = LIBRARY_MANIFEST.items;

// `restoreElements` (which `@arch-canvas/test-fixtures` runs every element through) assigns each
// element a fresh id on every load — the skeleton's own `id: 'fixture-rect-a'` does not survive
// restoration — so tests that need a specific element's id read it back off the fixture's arrow
// binding itself rather than hardcoding the skeleton's original strings.
const fixtureArrow = arrowWithBindingsFixture.find(
  (el): el is typeof el & { type: 'arrow' } => el.type === 'arrow',
);
if (!fixtureArrow?.startBinding || !fixtureArrow.endBinding) {
  throw new Error('arrowWithBindingsFixture must contain a fully-bound arrow');
}
const RECT_A_ID = fixtureArrow.startBinding.elementId;
const RECT_B_ID = fixtureArrow.endBinding.elementId;

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    scene: [...textFixture, ...arrowWithBindingsFixture],
    selection: [],
    library: LIBRARY,
    ...overrides,
  };
}

describe('read tools (T51, AIE-01)', () => {
  it('inspect_diagram summarizes element count and type breakdown against a test scene', async () => {
    const result = await inspectDiagramTool.execute(ctx(), {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.elementCount).toBe(4);
    expect(result.data.byType).toEqual({ text: 1, rectangle: 2, arrow: 1 });
  });

  it('get_selection resolves only the selected elements from the scene', async () => {
    const result = await getSelectionTool.execute(ctx({ selection: [RECT_A_ID] }), {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.elements).toEqual([
      { elementId: RECT_A_ID, type: 'rectangle', label: null },
    ]);
  });

  it('get_selection returns nothing for an id no longer in the scene, without throwing', async () => {
    const result = await getSelectionTool.execute(ctx({ selection: ['does-not-exist'] }), {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.elements).toEqual([]);
  });

  it('search_elements filters by type against the test scene', async () => {
    const result = await searchElementsTool.execute(ctx(), { limit: 50, type: 'rectangle' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.totalMatches).toBe(2);
    expect(result.data.elements.map((e) => e.elementId).sort()).toEqual(
      [RECT_A_ID, RECT_B_ID].sort(),
    );
  });

  it('search_elements filters by label query (case-insensitive) against the test scene', async () => {
    const result = await searchElementsTool.execute(ctx(), { limit: 50, query: 'ARCHITECTURE' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.elements).toHaveLength(1);
    expect(result.data.elements[0]?.label).toBe('Hello architecture canvas');
  });

  it('get_neighbors returns the elements connected by an edge to the given id, against the test scene', async () => {
    const result = await getNeighborsTool.execute(ctx(), { elementId: RECT_A_ID, depth: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.neighbors).toEqual([
      { elementId: RECT_B_ID, type: 'rectangle', label: null },
    ]);
    expect(result.data.edges).toEqual([{ from: RECT_A_ID, to: RECT_B_ID, label: null }]);
  });

  it('get_neighbors returns a structured error (not a throw) for an elementId outside the diagram', async () => {
    const result = await getNeighborsTool.execute(ctx(), { elementId: 'not-in-scene', depth: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.code).toBe('element_not_found');
  });

  it('search_library only ever resolves against the authorized library passed in ToolContext', async () => {
    const restrictedLibrary = LIBRARY.filter((item) => item.stableKey === 'generic.compute.server');
    const result = await searchLibraryTool.execute(ctx({ library: restrictedLibrary }), {
      query: 'aws',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // "aws" matches several real items in the FULL manifest (e.g. aws.ec2) but none in the
    // restricted authorized library passed here — proving no fallback to a wider library.
    expect(result.data.items).toEqual([]);
  });

  it('search_library matches by category against the full authorized library', async () => {
    const result = await searchLibraryTool.execute(ctx(), { category: 'database' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.items.map((i) => i.stableKey).sort()).toEqual(
      ['aws.rds', 'generic.database.relational-database'].sort(),
    );
  });

  it('get_library_component resolves a known stableKey from the authorized library', async () => {
    const result = await getLibraryComponentTool.execute(ctx(), { stableKey: 'aws.ec2' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.stableKey).toBe('aws.ec2');
  });

  it('get_library_component returns a structured error for a component outside the authorized library', async () => {
    const restrictedLibrary = LIBRARY.filter((item) => item.stableKey !== 'aws.ec2');
    const result = await getLibraryComponentTool.execute(ctx({ library: restrictedLibrary }), {
      stableKey: 'aws.ec2',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.code).toBe('not_found');
  });

  it('a tool call with schema-invalid arguments returns a structured error, never a throw', async () => {
    const registry = createDefaultToolRegistry();
    const result = await registry.execute(ctx(), 'get_neighbors', 1, { elementId: 42 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.code).toBe('invalid_args');
  });

  it('calling an unregistered tool name returns a structured error, never a throw', async () => {
    const registry = createDefaultToolRegistry();
    const result = await registry.execute(ctx(), 'delete_everything', 1, {});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.error.code).toBe('unknown_tool');
  });
});
