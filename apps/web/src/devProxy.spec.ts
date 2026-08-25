import { SERVER_ROUTE_PREFIXES, WS_ROUTE_PREFIX } from '@arch-canvas/shared-contracts';
import { describe, expect, it } from 'vitest';
import config from '../vite.config.js';

/**
 * EDGE-06..08: the dev proxy used to keep its own literal list, which covered six prefixes
 * and omitted seven — every omitted one silently answered `index.html` instead of JSON.
 * These assertions are about the generated proxy map, not about Vite.
 */
describe('dev server proxy (EDGE-06..08)', () => {
  const proxy = (config.server?.proxy ?? {}) as Record<
    string,
    { target?: string; ws?: boolean; changeOrigin?: boolean }
  >;

  it('forwards every server route prefix', () => {
    for (const prefix of SERVER_ROUTE_PREFIXES) {
      expect(Object.keys(proxy)).toContain(prefix);
    }
  });

  it('forwards no prefix the server does not own', () => {
    const httpKeys = Object.keys(proxy).filter((key) => key !== WS_ROUTE_PREFIX);
    expect(httpKeys.sort()).toEqual([...SERVER_ROUTE_PREFIXES].sort());
  });

  it('points every prefix at the server port', () => {
    for (const entry of Object.values(proxy)) {
      expect(entry.target).toBe('http://localhost:3000');
    }
  });

  it('marks the websocket prefix as an upgrade (EDGE-08)', () => {
    expect(proxy[WS_ROUTE_PREFIX]?.ws).toBe(true);
  });

  it('does not mark plain HTTP prefixes as upgrades', () => {
    for (const prefix of SERVER_ROUTE_PREFIXES) {
      expect(proxy[prefix]?.ws).toBeUndefined();
    }
  });
});
