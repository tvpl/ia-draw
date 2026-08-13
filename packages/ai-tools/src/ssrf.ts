import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF-safe `baseUrl` validation for AI provider configs (AIC-03). Resolves the
 * hostname (not just pattern-matches the string) so a hostname that merely
 * *points at* a blocked address via DNS is caught the same way a literal IP is —
 * pattern-matching the hostname string alone would miss that. Blocks loopback,
 * link-local (including the explicit cloud metadata address 169.254.169.254) and
 * the RFC 1918 private ranges, unless the host is present in an explicit
 * admin-provided `allowlist`.
 *
 * Known limitation: only IPv4 ranges plus the IPv6 loopback (`::1`) are checked.
 * IPv6 private/unique-local ranges (e.g. `fc00::/7`) are not covered — out of
 * scope for T41, which enumerates only the IPv4 ranges above; documented here
 * rather than silently expanded.
 */
export interface SsrfCheckResult {
  allowed: boolean;
  reason: string;
}

interface Ipv4Cidr {
  base: string;
  prefix: number;
}

const BLOCKED_IPV4_RANGES: readonly Ipv4Cidr[] = [
  { base: '127.0.0.0', prefix: 8 }, // loopback
  { base: '169.254.0.0', prefix: 16 }, // link-local — covers the metadata address 169.254.169.254
  { base: '10.0.0.0', prefix: 8 }, // private
  { base: '172.16.0.0', prefix: 12 }, // private
  { base: '192.168.0.0', prefix: 16 }, // private
];

function ipv4ToInt(ip: string): number {
  const octets = ip.split('.').map(Number);
  return (
    (((octets[0] ?? 0) << 24) |
      ((octets[1] ?? 0) << 16) |
      ((octets[2] ?? 0) << 8) |
      (octets[3] ?? 0)) >>>
    0
  );
}

function ipv4InRange(ip: string, range: Ipv4Cidr): boolean {
  const mask = range.prefix === 0 ? 0 : (0xffffffff << (32 - range.prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range.base) & mask);
}

function isBlockedIp(ip: string): boolean {
  if (ip === '::1') return true; // IPv6 loopback
  if (isIP(ip) === 4) return BLOCKED_IPV4_RANGES.some((range) => ipv4InRange(ip, range));
  return false;
}

/**
 * Validates `url` for use as an AI provider `baseUrl`. Rejects loopback,
 * link-local/metadata and private-range destinations unless the resolved
 * hostname is present in `allowlist` — an explicit, admin-provided escape
 * hatch for legitimate internal endpoints (AIC-03).
 */
export async function validateProviderBaseUrl(
  url: string,
  allowlist: readonly string[] = [],
): Promise<SsrfCheckResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: 'baseUrl is not a valid URL' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { allowed: false, reason: `unsupported protocol '${parsed.protocol}'` };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (allowlist.some((allowed) => allowed.toLowerCase() === hostname)) {
    return { allowed: true, reason: `host '${hostname}' is in the explicit allowlist` };
  }

  let candidateIps: string[];
  if (isIP(hostname) !== 0) {
    candidateIps = [hostname];
  } else {
    try {
      const results = await dnsLookup(hostname, { all: true });
      candidateIps = results.map((r) => r.address);
    } catch {
      return { allowed: false, reason: `could not resolve host '${hostname}'` };
    }
  }

  const blocked = candidateIps.find(isBlockedIp);
  if (blocked) {
    return {
      allowed: false,
      reason: `host '${hostname}' resolves to a blocked address range (${blocked})`,
    };
  }

  return { allowed: true, reason: `host '${hostname}' resolves to a public address` };
}
