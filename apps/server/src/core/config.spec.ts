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

  it('never throws in development, even with both secrets left at the insecure default (SEC-03)', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'development',
        SESSION_SECRET: INSECURE_DEV_SECRET,
        ENCRYPTION_KEY: INSECURE_DEV_SECRET,
      }),
    ).not.toThrow();
  });

  it('never throws in test, even with both secrets left at the insecure default (SEC-03)', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        SESSION_SECRET: INSECURE_DEV_SECRET,
        ENCRYPTION_KEY: INSECURE_DEV_SECRET,
      }),
    ).not.toThrow();
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

  describe('OIDC config (T87, OIDC-01/02/03)', () => {
    it('is undefined by default — the server boots and local auth works with no OIDC env vars at all', () => {
      const config = loadConfig({ NODE_ENV: 'development' });
      expect(config.oidc).toBeUndefined();
    });

    it('stays undefined unless ALL of issuer/client id/client secret are set', () => {
      expect(
        loadConfig({ NODE_ENV: 'development', OIDC_ISSUER_URL: 'https://idp.example' }).oidc,
      ).toBeUndefined();
      expect(
        loadConfig({
          NODE_ENV: 'development',
          OIDC_ISSUER_URL: 'https://idp.example',
          OIDC_CLIENT_ID: 'client-1',
        }).oidc,
      ).toBeUndefined();
    });

    it('is populated, with defaults for groupClaim/groupRoleMap, once all 3 core fields are set', () => {
      const config = loadConfig({
        NODE_ENV: 'development',
        OIDC_ISSUER_URL: 'https://idp.example',
        OIDC_CLIENT_ID: 'client-1',
        OIDC_CLIENT_SECRET: 'shh',
      });
      expect(config.oidc).toEqual({
        issuerUrl: 'https://idp.example',
        clientId: 'client-1',
        clientSecret: 'shh',
        groupClaim: 'groups',
        groupRoleMap: {},
        defaultWorkspaceId: undefined,
        redirectUri: 'http://localhost:3000/auth/oidc/callback',
      });
    });

    it('parses a valid OIDC_GROUP_ROLE_MAP and carries OIDC_DEFAULT_WORKSPACE_ID through', () => {
      const config = loadConfig({
        NODE_ENV: 'development',
        OIDC_ISSUER_URL: 'https://idp.example',
        OIDC_CLIENT_ID: 'client-1',
        OIDC_CLIENT_SECRET: 'shh',
        OIDC_GROUP_CLAIM: 'roles',
        OIDC_GROUP_ROLE_MAP: '{"platform-team":"editor","readonly-team":"viewer"}',
        OIDC_DEFAULT_WORKSPACE_ID: 'ws-1',
      });
      expect(config.oidc?.groupClaim).toBe('roles');
      expect(config.oidc?.groupRoleMap).toEqual({
        'platform-team': 'editor',
        'readonly-team': 'viewer',
      });
      expect(config.oidc?.defaultWorkspaceId).toBe('ws-1');
    });

    it('throws a clear error for malformed OIDC_GROUP_ROLE_MAP JSON — only when OIDC is otherwise configured', () => {
      expect(() =>
        loadConfig({
          NODE_ENV: 'development',
          OIDC_ISSUER_URL: 'https://idp.example',
          OIDC_CLIENT_ID: 'client-1',
          OIDC_CLIENT_SECRET: 'shh',
          OIDC_GROUP_ROLE_MAP: 'not json',
        }),
      ).toThrowError(/OIDC_GROUP_ROLE_MAP/);
    });

    it('throws a clear error when a mapped role is not one of the 5 known roles', () => {
      expect(() =>
        loadConfig({
          NODE_ENV: 'development',
          OIDC_ISSUER_URL: 'https://idp.example',
          OIDC_CLIENT_ID: 'client-1',
          OIDC_CLIENT_SECRET: 'shh',
          OIDC_GROUP_ROLE_MAP: '{"some-group":"super_admin"}',
        }),
      ).toThrowError(/OIDC_GROUP_ROLE_MAP/);
    });

    it('never throws for a malformed OIDC_GROUP_ROLE_MAP when OIDC is not fully configured (stray env var, feature unused)', () => {
      expect(() =>
        loadConfig({ NODE_ENV: 'development', OIDC_GROUP_ROLE_MAP: 'not json at all' }),
      ).not.toThrow();
    });
  });
});
