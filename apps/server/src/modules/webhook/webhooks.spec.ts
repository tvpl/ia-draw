import { describe, expect, it } from 'vitest';
import { isWebhookEventType, WEBHOOK_EVENT_TYPES } from './webhooks.js';

describe('webhook event type validation (T79, EXT-02)', () => {
  it('accepts every one of the 5 documented event types (docs/product-spec.md §7.3)', () => {
    expect(WEBHOOK_EVENT_TYPES).toEqual([
      'diagram.created',
      'diagram.updated',
      'diagram.published',
      'spec.generated',
      'comment.mentioned',
    ]);
    for (const type of WEBHOOK_EVENT_TYPES) {
      expect(isWebhookEventType(type)).toBe(true);
    }
  });

  it('rejects an event type outside the enum', () => {
    expect(isWebhookEventType('diagram.deleted')).toBe(false);
    expect(isWebhookEventType('')).toBe(false);
    expect(isWebhookEventType('DIAGRAM.CREATED')).toBe(false);
  });
});
