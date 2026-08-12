import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// FND-02 guardrail: "the system SHALL operate with outbound internet blocked, except
// for calls to the explicitly configured AI base URL". No route to a documented,
// reviewed HTTP client exists yet in this wave (the AI provider client lands in F2's
// ai-engine module) — so today the ONLY correct state is zero outbound-network-capable
// APIs anywhere in apps/server/src. This test makes that invariant regression-proof:
// it fails the moment any file imports a network client, forcing a deliberate,
// reviewed update to ALLOWED_EGRESS_FILES (not a silent addition) when F2 introduces
// the single allowlisted AI HTTP client.
const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Files permitted to reference a network-capable API, relative to `apps/server/src`.
 * Empty today by design (see file header) — F2's AI provider client is the first
 * expected entry, added deliberately alongside its own SSRF/allowlist safeguards.
 */
const ALLOWED_EGRESS_FILES = new Set<string>([
  // F2's single allowlisted AI HTTP client (T42, AIC-02) — calls only the admin-configured
  // provider's baseUrl, server-side, behind SSRF validation (packages/ai-tools). Every
  // production call is preceded by validateProviderBaseUrl at config write time (routes.ts);
  // tests always inject a mock fetchImpl, never hitting the network (see ai-provider.int.spec.ts).
  'modules/ai-provider/testConnection.ts',
]);

// Matches an actual import/require of a network-capable module, or a call to the
// global `fetch`. Anchored to import/require syntax and to `fetch(` as a call (not a
// bare identifier) so mentioning these words in prose comments doesn't trip it.
const EGRESS_PATTERN =
  /(?:from\s+|require\()['"](?:node:)?(?:http|https|net|dgram|dns)['"]|(?:from\s+|require\()['"](?:axios|undici|node-fetch|got|superagent)['"]|(?<![.\w])fetch\s*\(/;

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('no outbound network calls outside the allowlist (FND-02)', () => {
  const files = collectSourceFiles(SRC_DIR).filter((file) => !file.endsWith('.spec.ts'));

  it('scanned at least one source file', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s has no unreviewed network-capable import or fetch call', (file) => {
    const relative = file.slice(SRC_DIR.length + 1);
    if (ALLOWED_EGRESS_FILES.has(relative)) return;

    const content = readFileSync(file, 'utf8');
    const match = content.match(EGRESS_PATTERN);
    expect(match?.[0] ?? null).toBeNull();
  });
});
