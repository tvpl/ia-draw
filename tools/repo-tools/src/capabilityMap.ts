import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** One reason a capability-map entry does not match the code. */
export interface CapabilityMapViolation {
  /** The offending entry, by capability name or by position when unnamed. */
  entry: string;
  problem: string;
}

const REQUIRED_FIELDS = ['capability', 'requirements', 'backend_evidence', 'ui_surface'] as const;

/** Every UI surface must live here — a claim pointing anywhere else is not a product surface. */
const UI_ROOT = 'apps/web/src';

/**
 * Validates the capability map against the code it describes (TRU-02, TRU-03).
 * Returns one violation per problem found; an empty array means the map holds.
 *
 * A map with no capabilities is a violation on its own: passing an empty map
 * would prove nothing while reporting success.
 */
export function checkCapabilityMap(map: unknown, sourceRoot: string): CapabilityMapViolation[] {
  const entries = (map as { capabilities?: unknown } | null)?.capabilities;

  if (!Array.isArray(entries) || entries.length === 0) {
    return [
      {
        entry: 'capabilities',
        problem: 'the capability map declares no capability, so it proves nothing',
      },
    ];
  }

  const violations: CapabilityMapViolation[] = [];

  entries.forEach((raw, index) => {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const entryLabel =
      typeof entry.capability === 'string' ? entry.capability : `capabilities[${index}]`;

    for (const field of REQUIRED_FIELDS) {
      if (!(field in entry)) {
        violations.push({ entry: entryLabel, problem: `missing required field \`${field}\`` });
      }
    }

    const surface = entry.ui_surface;

    if (surface === null) {
      if (entry.status !== 'backend-only') {
        violations.push({
          entry: entryLabel,
          problem: 'ui_surface is null without `status: backend-only`',
        });
      }
      return;
    }

    if (typeof surface !== 'string') return;

    if (!surface.startsWith(`${UI_ROOT}/`)) {
      violations.push({
        entry: entryLabel,
        problem: `ui_surface \`${surface}\` is not under ${UI_ROOT}`,
      });
      return;
    }

    if (!existsSync(join(sourceRoot, ...surface.split('/')))) {
      violations.push({
        entry: entryLabel,
        problem: `ui_surface \`${surface}\` does not exist`,
      });
    }
  });

  return violations;
}
