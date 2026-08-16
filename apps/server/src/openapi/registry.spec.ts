import { describe, expect, it } from 'vitest';
import { registry } from './registry.js';

describe('registry (T3, API-01)', () => {
  it('includes the ai-provider module with all 5 of its real routes', () => {
    expect(Object.keys(registry['ai-provider'] ?? {}).sort()).toEqual(
      [
        'GET /admin/ai-providers',
        'POST /admin/ai-providers',
        'PATCH /admin/ai-providers/:id',
        'POST /admin/ai-providers/:id(^[^:]+):test',
      ].sort(),
    );
  });
});
