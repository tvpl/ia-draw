import { ROLES } from '@arch-canvas/auth';
import { describe, expect, it } from 'vitest';
import { isRoleWithinCeiling, isShareLinkActive, type ShareLinkRow } from './shareLinks.js';

function link(overrides: Partial<ShareLinkRow> = {}): ShareLinkRow {
  return {
    id: 'link-1',
    resourceType: 'diagram',
    resourceId: 'diagram-1',
    tokenHash: 'hash',
    role: 'viewer',
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    createdBy: 'user-1',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('isRoleWithinCeiling (T78, EXT-01 role ceiling)', () => {
  it('an editor may grant editor/reviewer/viewer (never above their own role)', () => {
    expect(isRoleWithinCeiling('editor', 'editor')).toBe(true);
    expect(isRoleWithinCeiling('editor', 'reviewer')).toBe(true);
    expect(isRoleWithinCeiling('editor', 'viewer')).toBe(true);
  });

  it('an editor may NOT grant workspace_admin or org_admin (above their own role)', () => {
    expect(isRoleWithinCeiling('editor', 'workspace_admin')).toBe(false);
    expect(isRoleWithinCeiling('editor', 'org_admin')).toBe(false);
  });

  it('a viewer may only grant viewer (their own privilege floor)', () => {
    expect(isRoleWithinCeiling('viewer', 'viewer')).toBe(true);
    expect(isRoleWithinCeiling('viewer', 'reviewer')).toBe(false);
    expect(isRoleWithinCeiling('viewer', 'editor')).toBe(false);
  });

  it('org_admin may grant any role, including org_admin itself', () => {
    for (const role of ROLES) {
      expect(isRoleWithinCeiling('org_admin', role)).toBe(true);
    }
  });

  it('every role may always grant itself', () => {
    for (const role of ROLES) {
      expect(isRoleWithinCeiling(role, role)).toBe(true);
    }
  });
});

describe('isShareLinkActive (T78, EXT-01)', () => {
  it('an unrevoked, unexpired link is active', () => {
    expect(isShareLinkActive(link())).toBe(true);
  });

  it('a revoked link is never active, even before its expiresAt', () => {
    expect(isShareLinkActive(link({ revokedAt: new Date() }))).toBe(false);
  });

  it('an expired link is never active, even if never revoked', () => {
    expect(isShareLinkActive(link({ expiresAt: new Date(Date.now() - 1_000) }))).toBe(false);
  });

  it('a link expiring exactly "now" is still active (inclusive boundary)', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(isShareLinkActive(link({ expiresAt: now }), now)).toBe(true);
  });
});
