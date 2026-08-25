import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** One reason a capability-map entry does not match the code. */
export interface CapabilityMapViolation {
  /** The offending entry, by capability name or by position when unnamed. */
  entry: string;
  problem: string;
}

const REQUIRED_FIELDS = ['capability', 'requirements', 'backend_evidence', 'ui_surface'] as const;

/**
 * DOCS-05: which module file backs this capability. The map has no `routes` field, and
 * deliberately does not gain one — `backend_evidence` already names the module, and the
 * route inventory already knows which file registered each route, so the link exists
 * without a third place to keep in sync.
 */
function backendModuleOf(entry: Record<string, unknown>): string | null {
  const evidence = entry.backend_evidence;
  return typeof evidence === 'string' ? evidence : null;
}

/** Every UI surface must live here — a claim pointing anywhere else is not a product surface. */
const UI_ROOT = 'apps/web/src';

/** Directory segment holding translation catalogues — data the UI reads, never a surface. */
const LOCALES_SEGMENT = 'locales';

/**
 * A declared surface has to be a UI component module, not just any file that
 * happens to exist under `apps/web/src`. Existence alone is not evidence: a
 * capability repointed at a translation catalogue kept the audit green in
 * round 1 (validation.md, mutant M6). Accepted: `.ts`/`.tsx` source modules.
 * Rejected: every other extension, type declarations, test files, and anything
 * inside a `locales/` directory.
 */
function isComponentModule(surface: string): boolean {
  const fileName = surface.split('/').pop() ?? '';

  if (!fileName.endsWith('.ts') && !fileName.endsWith('.tsx')) return false;
  if (fileName.endsWith('.d.ts')) return false;
  if (/\.(spec|test)\.tsx?$/.test(fileName)) return false;

  return !surface.split('/').includes(LOCALES_SEGMENT);
}

/**
 * Validates the capability map against the code it describes (TRU-02, TRU-03).
 * Returns one violation per problem found; an empty array means the map holds.
 *
 * A map with no capabilities is a violation on its own: passing an empty map
 * would prove nothing while reporting success.
 */
export function checkCapabilityMap(
  map: unknown,
  sourceRoot: string,
  /**
   * DOCS-05: for each server module file, the consumers `apps/web/src` already has for the
   * routes registered in it. Lets the audit check the REVERSE direction — a capability
   * marked `backend-only` whose routes already have a screen. Omit it and only the forward
   * direction runs, which is what the audit did until now: creating a screen never forced
   * the map to be updated, so the documentation could only ever understate what shipped.
   */
  consumersByModule?: ReadonlyMap<string, readonly string[]>,
): CapabilityMapViolation[] {
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
      // DOCS-05: the reverse direction. A capability may only claim to have no surface
      // while none of the routes in its backing module has a consumer in `apps/web/src`.
      const module = backendModuleOf(entry);
      const consumers = module ? consumersByModule?.get(module) : undefined;
      if (consumers && consumers.length > 0) {
        violations.push({
          entry: entryLabel,
          problem: `marked backend-only but ${module}'s routes are consumed by ${consumers.join(', ')}`,
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

    if (!isComponentModule(surface)) {
      violations.push({
        entry: entryLabel,
        problem: `ui_surface \`${surface}\` is not a UI component module`,
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
