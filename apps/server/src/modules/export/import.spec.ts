import type { SceneElement } from '@arch-canvas/editor-adapter';
import { allFixtures } from '@arch-canvas/test-fixtures';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_APP_STATE } from './generateExports.js';
import { InvalidImportError, MAX_IMPORT_ELEMENTS, previewImport } from './import.js';
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

  it('accepts a file at exactly the MAX_IMPORT_ELEMENTS ceiling', () => {
    const elements = Array.from({ length: MAX_IMPORT_ELEMENTS }, (_, i) => ({ id: `e${i}` }));
    const fileContent = JSON.stringify({
      type: 'architecture-canvas/scene',
      version: 1,
      elements,
      appState: {},
    });

    const { preview } = previewImport(fileContent);

    expect(preview.elementCount).toBe(MAX_IMPORT_ELEMENTS);
  });

  it('rejects an import exceeding MAX_IMPORT_ELEMENTS with a clear error, before any persistence would happen', () => {
    const elements = Array.from({ length: MAX_IMPORT_ELEMENTS + 1 }, (_, i) => ({ id: `e${i}` }));
    const fileContent = JSON.stringify({
      type: 'architecture-canvas/scene',
      version: 1,
      elements,
      appState: {},
    });

    expect(() => previewImport(fileContent)).toThrow(InvalidImportError);
    expect(() => previewImport(fileContent)).toThrow(/exceeding the 20000-element import limit/);
  });
});
