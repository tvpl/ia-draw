import { describe, expect, it } from 'vitest';
import { frameLabel } from './frameLabel.js';

describe('frameLabel (T5)', () => {
  it('with a frameId: labelWithId, carrying both position and frameId', () => {
    expect(frameLabel({ frameId: 'overview' }, 1)).toEqual({
      key: 'presentation.frame.labelWithId',
      params: { position: 1, frameId: 'overview' },
    });
  });

  it('without a frameId (elementId-only or fully logical, no label): plain position-only label', () => {
    expect(frameLabel({ frameId: null }, 3)).toEqual({
      key: 'presentation.frame.label',
      params: { position: 3 },
    });
  });

  it('an empty-string frameId is treated the same as null (falsy, no label to show)', () => {
    expect(frameLabel({ frameId: '' }, 2)).toEqual({
      key: 'presentation.frame.label',
      params: { position: 2 },
    });
  });
});
