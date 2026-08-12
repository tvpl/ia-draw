import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Domain tools (T51/T52, design.md "executores puros... nunca tocam banco
 * ou rede") must have zero ability to reach the network, filesystem or a
 * child process — regression-proofed the same way `apps/server`'s
 * `no-egress.spec.ts` protects its own invariant: scan every non-test
 * source file in this directory for the relevant imports/calls.
 */
const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));

const FORBIDDEN_PATTERN =
  /(?:from\s+|require\()['"](?:node:)?(?:fs(?:\/promises)?|http|https|net|dgram|dns|child_process)['"]|(?<![.\w])fetch\s*\(/;

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('ai-tools domain tools have no network/fs/process access (AIE-01, design.md §8.3)', () => {
  const files = collectSourceFiles(TOOLS_DIR).filter((file) => !file.endsWith('.spec.ts'));

  it('scanned at least one source file', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s has no fetch/fs/child_process import or call', (file) => {
    const content = readFileSync(file, 'utf8');
    const match = content.match(FORBIDDEN_PATTERN);
    expect(match?.[0] ?? null).toBeNull();
  });
});
