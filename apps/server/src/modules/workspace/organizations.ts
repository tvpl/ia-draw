import { organizations } from '@arch-canvas/database';
import type { Db } from '../auth/db.js';

/**
 * "Organização única no MVP" (docs/product-spec.md §3.1) — every workspace
 * belongs to one canonical organization for this self-hosted instance.
 * There is no org-creation flow in this wave, so the first workspace
 * creation lazily provisions it if it doesn't exist yet (idempotent).
 */
const DEFAULT_ORGANIZATION_SLUG = 'default';

export async function getOrCreateDefaultOrganization(db: Db): Promise<{ id: string }> {
  const [existing] = await db.select({ id: organizations.id }).from(organizations).limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(organizations)
    .values({ name: 'Default Organization', slug: DEFAULT_ORGANIZATION_SLUG })
    .returning({ id: organizations.id });
  if (!created) throw new Error('failed to provision the default organization');
  return created;
}
