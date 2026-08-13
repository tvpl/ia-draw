import { describe, expect, it } from 'vitest';
import { sanitizeAppState } from './sanitizeAppState.js';
import type { ReconcileAppState } from './types.js';

describe('sanitizeAppState', () => {
  it('keeps only the fields that affect the persisted scene, dropping ephemeral state', () => {
    const appState = {
      viewBackgroundColor: '#abcdef',
      gridSize: 20,
      gridStep: 10,
      gridModeEnabled: true,
      zenModeEnabled: true,
      theme: 'dark',
      name: 'My Diagram',
      // ephemeral / session-only fields that must NOT survive sanitization
      selectedElementIds: { 'el-1': true },
      collaborators: new Map(),
      editingTextElement: { id: 'el-2' },
      cursorButton: 'down',
      scrollX: 123,
      scrollY: 456,
      zoom: { value: 2 },
      contextMenu: { items: [], top: 0, left: 0 },
    } as unknown as Partial<ReconcileAppState>;

    const sanitized = sanitizeAppState(appState);

    expect(sanitized).toEqual({
      viewBackgroundColor: '#abcdef',
      gridSize: 20,
      gridStep: 10,
      gridModeEnabled: true,
      zenModeEnabled: true,
      theme: 'dark',
      name: 'My Diagram',
    });
  });

  it('fills in sane defaults when the input appState is minimal', () => {
    const sanitized = sanitizeAppState({});

    expect(sanitized).toEqual({
      viewBackgroundColor: '#ffffff',
      gridSize: 0,
      gridStep: 5,
      gridModeEnabled: false,
      zenModeEnabled: false,
      theme: 'light',
      name: null,
    });
  });
});
