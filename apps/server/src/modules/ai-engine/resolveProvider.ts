import { aiProviderConfigs } from '@arch-canvas/database';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

export interface ResolvedProviderConfig {
  id: string;
  scope: string;
  baseUrl: string;
  model: string;
  encryptedToken: string;
  capabilitiesJson: unknown;
}

const GLOBAL_SCOPE = 'global';

/**
 * Resolves the enabled `ai_provider_configs` row a run should use for
 * `workspaceId` — a workspace-scoped config takes precedence over the
 * `"global"`-scoped one (mirrors the admin scope model already established
 * by ai-provider/routes.ts's `assertProviderAdmin`). Returns `null` when
 * neither exists or the only match is disabled — the pipeline (T53) turns
 * that into a `failed` run rather than throwing.
 */
export async function resolveProviderConfig(
  db: Db,
  workspaceId: string,
): Promise<ResolvedProviderConfig | null> {
  const [workspaceScoped] = await db
    .select()
    .from(aiProviderConfigs)
    .where(and(eq(aiProviderConfigs.scope, workspaceId), eq(aiProviderConfigs.enabled, true)));
  if (workspaceScoped) return workspaceScoped;

  const [global] = await db
    .select()
    .from(aiProviderConfigs)
    .where(and(eq(aiProviderConfigs.scope, GLOBAL_SCOPE), eq(aiProviderConfigs.enabled, true)));
  return global ?? null;
}
