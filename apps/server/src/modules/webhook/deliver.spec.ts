import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signWebhookPayload } from './deliver.js';

describe('signWebhookPayload (T80, EXT-02)', () => {
  it('produces `sha256=<hex hmac>`, matching a manual HMAC-SHA256 computation over the exact serialized payload', () => {
    const secret = 'a-test-secret';
    const payload = JSON.stringify({ eventType: 'diagram.created', diagramId: 'd1' });

    const signature = signWebhookPayload(secret, payload);
    const expectedDigest = createHmac('sha256', secret).update(payload).digest('hex');

    expect(signature).toBe(`sha256=${expectedDigest}`);
  });

  it('is deterministic for the same secret+payload, and differs for a different secret or a different payload', () => {
    const payload = JSON.stringify({ a: 1 });
    const s1 = signWebhookPayload('secret-one', payload);
    const s2 = signWebhookPayload('secret-one', payload);
    const s3 = signWebhookPayload('secret-two', payload);
    const s4 = signWebhookPayload('secret-one', JSON.stringify({ a: 2 }));

    expect(s1).toBe(s2);
    expect(s1).not.toBe(s3);
    expect(s1).not.toBe(s4);
  });
});
