import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Token cipher for `ai_provider_configs.encrypted_token` (T40/AIC-01) — AES-256-GCM
 * via Node's native `crypto`, no external dependency. `masterKey` always comes from
 * config (env/secret — `AppConfig.encryptionKey`), never hardcoded.
 *
 * The master key is hashed with SHA-256 to derive a stable 32-byte AES-256 key
 * regardless of the input string's length — `loadConfig`'s `ENCRYPTION_KEY` is an
 * arbitrary-length secret, not necessarily 32 raw bytes.
 *
 * Ciphertext format: `v1:<iv base64>:<authTag base64>:<data base64>` — versioned so
 * a future key-derivation or algorithm change can be introduced without breaking
 * decryption of already-stored ciphertexts (design.md's `KeyProvider` swap-without-
 * migration goal). A future KMS/Vault-backed `KeyProvider` can wrap these two
 * functions without changing this format.
 */
const ALGORITHM = 'aes-256-gcm';
/** GCM's standard, recommended nonce size. */
const IV_LENGTH_BYTES = 12;
const CIPHERTEXT_VERSION = 'v1';

function deriveKey(masterKey: string): Buffer {
  return createHash('sha256').update(masterKey, 'utf8').digest();
}

/** Encrypts `plaintext` (e.g. a provider API token) with `masterKey`. Never logs or returns the plaintext. */
export function encryptToken(plaintext: string, masterKey: string): string {
  const key = deriveKey(masterKey);
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    CIPHERTEXT_VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/** Decrypts a ciphertext produced by `encryptToken`. Throws on a malformed ciphertext or a wrong `masterKey` (GCM auth-tag mismatch). */
export function decryptToken(ciphertext: string, masterKey: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || parts[0] !== CIPHERTEXT_VERSION) {
    throw new Error('decryptToken: unrecognized ciphertext format');
  }
  const [, ivBase64, authTagBase64, dataBase64] = parts as [string, string, string, string];

  const key = deriveKey(masterKey);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivBase64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagBase64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataBase64, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
