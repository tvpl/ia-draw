import type { SceneElement } from '@arch-canvas/editor-adapter';
import { allFixtures } from '@arch-canvas/test-fixtures';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_APP_STATE } from './generateExports.js';
import { InvalidImportError, previewImport } from './import.js';
import { serializeScene } from './sceneFile.js';

describe('previewImport', () => {
  it('returns a preview with the correct element count and appState for a valid .excalidraw file (EXP-03)', () => {
    const elements = allFixtures.frame as readonly SceneElement[];
    const fileContent = serializeScene(elements, DEFAULT_EXPORT_APP_STATE);

    const { preview, elements: parsedElements } = previewImport(fileContent);

    expect(preview.elementCount).toBe(elements.length);
    expect(preview.appState).toEqual(DEFAULT_EXPORT_APP_STATE);
    expect(parsedElements).toEqual(elements);
  });

  it('rejects malformed JSON with a clear InvalidImportError (EXP-03 edge case) before any persistence would happen', () => {
    expect(() => previewImport('{ not valid json')).toThrow(InvalidImportError);
    expect(() => previewImport('{ not valid json')).toThrow(/malformed \.excalidraw file/);
  });

  it('rejects a JSON file that is not the architecture-canvas/scene envelope', () => {
    const notAScene = JSON.stringify({ type: 'not-a-scene', elements: [], appState: {} });

    expect(() => previewImport(notAScene)).toThrow(InvalidImportError);
  });

  it('rejects a file whose "elements" field is not an array', () => {
    const badShape = JSON.stringify({
      type: 'architecture-canvas/scene',
      version: 1,
      elements: 'not-an-array',
      appState: {},
    });

    expect(() => previewImport(badShape)).toThrow(/has no "elements" array/);
  });
});
