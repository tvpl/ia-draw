import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken } from './crypto.js';

describe('encryptToken/decryptToken (T41, AIC-01)', () => {
  it('round-trips the plaintext correctly', () => {
    const plaintext = 'sk-super-secret-provider-token-1234567890';
    const masterKey = 'test-master-key';

    const ciphertext = encryptToken(plaintext, masterKey);
    const decrypted = decryptToken(ciphertext, masterKey);

    expect(decrypted).toBe(plaintext);
  });

  it('the ciphertext never contains the plaintext as a substring', () => {
    const plaintext = 'sk-super-secret-provider-token-1234567890';
    const ciphertext = encryptToken(plaintext, 'test-master-key');

    expect(ciphertext).not.toContain(plaintext);
  });

  it('produces a different ciphertext each time (random IV) even for the same plaintext/key', () => {
    const plaintext = 'sk-same-token';
    const masterKey = 'test-master-key';

    const first = encryptToken(plaintext, masterKey);
    const second = encryptToken(plaintext, masterKey);

    expect(first).not.toBe(second);
    expect(decryptToken(first, masterKey)).toBe(plaintext);
    expect(decryptToken(second, masterKey)).toBe(plaintext);
  });

  it('fails to decrypt with the wrong master key (GCM auth tag mismatch)', () => {
    const ciphertext = encryptToken('sk-a-token', 'correct-master-key');
    expect(() => decryptToken(ciphertext, 'wrong-master-key')).toThrow();
  });

  it('rejects a malformed ciphertext', () => {
    expect(() => decryptToken('not-a-real-ciphertext', 'any-key')).toThrow(
      'decryptToken: unrecognized ciphertext format',
    );
  });

  it('round-trips an empty string plaintext', () => {
    const ciphertext = encryptToken('', 'test-master-key');
    expect(decryptToken(ciphertext, 'test-master-key')).toBe('');
  });
});
