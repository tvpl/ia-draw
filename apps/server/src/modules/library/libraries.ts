import { libraries } from '@arch-canvas/database';
import { and, eq, isNull, or } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

export interface LibraryRow {
  id: string;
  workspaceId: string | null;
  name: string;
  version: string;
  license: string;
  manifestJson: unknown;
  enabled: boolean;
}

/**
 * Lists every library the actor is authorized to see: the global library
 * (`workspace_id IS NULL`, always included) plus, when `workspaceId` is
 * given, that workspace's own libraries. Only `enabled` libraries are
 * returned (T39 "lista libraries autorizadas").
 */
export async function listAuthorizedLibraries(
  db: Db,
  workspaceId: string | null,
): Promise<LibraryRow[]> {
  const scopeFilter = workspaceId
    ? or(isNull(libraries.workspaceId), eq(libraries.workspaceId, workspaceId))
    : isNull(libraries.workspaceId);

  return db
    .select()
    .from(libraries)
    .where(and(eq(libraries.enabled, true), scopeFilter));
}
