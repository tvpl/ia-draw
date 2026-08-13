import { aiProviderConfigs } from '@arch-canvas/database';
import { eq } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

/**
 * The only shape ever returned from a route in this module — deliberately
 * omits `encryptedToken` at the type level, not just by convention (AIC-01:
 * "a resposta da API nunca inclui o token, nem cifrado nem em claro").
 */
export interface ProviderConfigPublic {
  id: string;
  scope: string;
  baseUrl: string;
  model: string;
  capabilitiesJson: unknown;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Internal-only shape carrying the ciphertext — used exclusively by the `:test` handler, never serialized into a response. */
export interface ProviderConfigInternal extends ProviderConfigPublic {
  encryptedToken: string;
}

const PUBLIC_COLUMNS = {
  id: aiProviderConfigs.id,
  scope: aiProviderConfigs.scope,
  baseUrl: aiProviderConfigs.baseUrl,
  model: aiProviderConfigs.model,
  capabilitiesJson: aiProviderConfigs.capabilitiesJson,
  enabled: aiProviderConfigs.enabled,
  createdAt: aiProviderConfigs.createdAt,
  updatedAt: aiProviderConfigs.updatedAt,
} as const;

export interface CreateProviderConfigInput {
  scope: string;
  baseUrl: string;
  model: string;
  encryptedToken: string;
  capabilitiesJson?: Record<string, unknown>;
  enabled?: boolean;
}

export async function listProviderConfigs(db: Db, scope?: string): Promise<ProviderConfigPublic[]> {
  const query = db.select(PUBLIC_COLUMNS).from(aiProviderConfigs);
  if (scope) return query.where(eq(aiProviderConfigs.scope, scope));
  return query;
}

export async function getProviderConfigPublic(
  db: Db,
  id: string,
): Promise<ProviderConfigPublic | null> {
  const [row] = await db
    .select(PUBLIC_COLUMNS)
    .from(aiProviderConfigs)
    .where(eq(aiProviderConfigs.id, id));
  return row ?? null;
}

/** Internal-only read — includes `encryptedToken`. Callers MUST NOT return this row from an HTTP response. */
export async function getProviderConfigInternal(
  db: Db,
  id: string,
): Promise<ProviderConfigInternal | null> {
  const [row] = await db.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.id, id));
  return row ?? null;
}

export async function createProviderConfig(
  db: Db,
  input: CreateProviderConfigInput,
): Promise<ProviderConfigPublic> {
  const [row] = await db
    .insert(aiProviderConfigs)
    .values({
      scope: input.scope,
      baseUrl: input.baseUrl,
      model: input.model,
      encryptedToken: input.encryptedToken,
      capabilitiesJson: input.capabilitiesJson ?? {},
      enabled: input.enabled ?? true,
    })
    .returning(PUBLIC_COLUMNS);
  if (!row) throw new Error('createProviderConfig: insert returned no row');
  return row;
}

export interface UpdateProviderConfigInput {
  baseUrl?: string;
  model?: string;
  encryptedToken?: string;
  capabilitiesJson?: Record<string, unknown>;
  enabled?: boolean;
}

export async function updateProviderConfig(
  db: Db,
  id: string,
  input: UpdateProviderConfigInput,
): Promise<ProviderConfigPublic | null> {
  const [row] = await db
    .update(aiProviderConfigs)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(aiProviderConfigs.id, id))
    .returning(PUBLIC_COLUMNS);
  return row ?? null;
}
