import { describe, expect, it } from 'vitest';
// Imported through the package index on purpose: T1's own criterion is that the list is
// consumable by `apps/web` and `repo-tools`, and those import the package, not this file.
import * as packageIndex from './index.js';
import { SERVER_ROUTE_PREFIXES, WS_ROUTE_PREFIX } from './routePrefixes.js';

describe('SERVER_ROUTE_PREFIXES (EDGE-09)', () => {
  it('is not empty', () => {
    expect(SERVER_ROUTE_PREFIXES.length).toBeGreaterThan(0);
  });

  it('contains no duplicates', () => {
    expect(new Set(SERVER_ROUTE_PREFIXES).size).toBe(SERVER_ROUTE_PREFIXES.length);
  });

  it('every prefix starts with a single slash', () => {
    for (const prefix of SERVER_ROUTE_PREFIXES) {
      expect(prefix.startsWith('/')).toBe(true);
      expect(prefix.startsWith('//')).toBe(false);
    }
  });

  it('no prefix carries a colon — both edges match by path prefix (EDGE-08 edge case)', () => {
    for (const prefix of SERVER_ROUTE_PREFIXES) {
      expect(prefix).not.toContain(':');
    }
  });

  it('no prefix is a path segment inside another, which would make edge ordering matter', () => {
    for (const prefix of SERVER_ROUTE_PREFIXES) {
      const others = SERVER_ROUTE_PREFIXES.filter((candidate) => candidate !== prefix);
      expect(others.some((candidate) => prefix.startsWith(`${candidate}/`))).toBe(false);
    }
  });

  it('covers /users:lookup through its /users prefix (EDGE-08 edge case)', () => {
    expect(SERVER_ROUTE_PREFIXES).toContain('/users');
  });

  it('is re-exported by the package index, which is what consumers import (EDGE-09)', () => {
    expect(packageIndex.SERVER_ROUTE_PREFIXES).toBe(SERVER_ROUTE_PREFIXES);
    expect(packageIndex.WS_ROUTE_PREFIX).toBe(WS_ROUTE_PREFIX);
  });

  it('keeps the websocket prefix out of the HTTP list — it needs ws: true in the dev proxy', () => {
    expect(WS_ROUTE_PREFIX).toBe('/ws');
    expect(SERVER_ROUTE_PREFIXES).not.toContain(WS_ROUTE_PREFIX);
  });
});
