import { describe, expect, it } from 'vitest';
import { INSECURE_DEV_SECRET, loadConfig } from './config.js';

describe('loadConfig (spec §12 / FND-03)', () => {
  it('succeeds with defaults in development, including the documented insecure placeholder', () => {
    const config = loadConfig({ NODE_ENV: 'development' });
    expect(config.nodeEnv).toBe('development');
    expect(config.sessionSecret).toBe(INSECURE_DEV_SECRET);
    expect(config.encryptionKey).toBe(INSECURE_DEV_SECRET);
    expect(config.port).toBe(3000);
    expect(config.publicUrl).toBe('http://localhost:3000');
    expect(config.s3).toEqual({
      endpoint: 'http://localhost:9000',
      accessKeyId: 'arch-canvas-dev',
      secretAccessKey: INSECURE_DEV_SECRET,
      region: 'us-east-1',
    });
    // REDIS_URL is optional (AD-006/AD-009, F4/T81) — omitted entirely by default.
    expect(config.redisUrl).toBeUndefined();
  });

  it('carries REDIS_URL through when set — ws-gateway (T81) uses it to pick RedisPresenceBroadcaster', () => {
    const config = loadConfig({ NODE_ENV: 'development', REDIS_URL: 'redis://localhost:6379' });
    expect(config.redisUrl).toBe('redis://localhost:6379');
  });

  it('throws naming SESSION_SECRET when production keeps the insecure default', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        SESSION_SECRET: INSECURE_DEV_SECRET,
        ENCRYPTION_KEY: 'a-unique-production-encryption-key',
      }),
    ).toThrowError(/SESSION_SECRET/);
  });

  it('throws naming ENCRYPTION_KEY when production keeps the insecure default', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        SESSION_SECRET: 'a-unique-production-session-secret',
        ENCRYPTION_KEY: INSECURE_DEV_SECRET,
      }),
    ).toThrowError(/ENCRYPTION_KEY/);
  });

  it('succeeds in production when every secret is overridden with a non-default value', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      SESSION_SECRET: 'a-unique-production-session-secret',
      ENCRYPTION_KEY: 'a-unique-production-encryption-key',
      PORT: '8080',
    });
    expect(config.nodeEnv).toBe('production');
    expect(config.sessionSecret).toBe('a-unique-production-session-secret');
    expect(config.encryptionKey).toBe('a-unique-production-encryption-key');
    expect(config.port).toBe(8080);
  });
});
