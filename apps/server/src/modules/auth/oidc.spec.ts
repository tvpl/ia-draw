import { describe, expect, it } from 'vitest';
import { resolveOidcRole } from './oidc.js';

describe('resolveOidcRole (T87, OIDC-02) — group claim -> role, never above the mapping ceiling', () => {
  it('returns the mapped role for a single matching group', () => {
    expect(resolveOidcRole(['platform-team'], { 'platform-team': 'editor' })).toBe('editor');
  });

  it('returns null when the claim value is not an array at all', () => {
    expect(resolveOidcRole('platform-team', { 'platform-team': 'editor' })).toBeNull();
    expect(resolveOidcRole(undefined, { 'platform-team': 'editor' })).toBeNull();
    expect(resolveOidcRole(null, { 'platform-team': 'editor' })).toBeNull();
    expect(resolveOidcRole({ role: 'workspace_admin' }, { 'platform-team': 'editor' })).toBeNull();
  });

  it('returns null when none of the groups in the array are in the map — never a fallback role', () => {
    expect(resolveOidcRole(['unmapped-group'], { 'platform-team': 'editor' })).toBeNull();
  });

  it('ignores non-string entries in the array (malformed/adversarial token) without throwing', () => {
    expect(
      resolveOidcRole(['platform-team', 42, { nested: true }, null], { 'platform-team': 'editor' }),
    ).toBe('editor');
  });

  it('when multiple groups match, picks the HIGHEST-privilege mapped role — never anything beyond it', () => {
    const map = {
      'readonly-team': 'viewer',
      'platform-team': 'editor',
      'super-team': 'org_admin',
    } as const;
    expect(resolveOidcRole(['readonly-team', 'platform-team'], map)).toBe('editor');
    expect(resolveOidcRole(['readonly-team', 'platform-team', 'super-team'], map)).toBe(
      'org_admin',
    );
  });

  it('the adversarial property: an extra suggestive group NOT present in the map never elevates the result', () => {
    const map = { 'platform-team': 'viewer' } as const;
    // "workspace_admin" here is a GROUP NAME the token claims to carry, not a
    // role — since it has no entry in the map, it must never be treated as
    // if it were one, and must never suggest a role beyond what
    // "platform-team" itself maps to.
    expect(resolveOidcRole(['platform-team', 'workspace_admin', 'org_admin'], map)).toBe('viewer');
  });

  it('an empty map never grants any role, regardless of what groups are present', () => {
    expect(resolveOidcRole(['platform-team', 'anything'], {})).toBeNull();
  });
});
