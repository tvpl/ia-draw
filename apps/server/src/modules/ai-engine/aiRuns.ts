import { aiRuns, aiToolCalls } from '@arch-canvas/database';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../auth/db.js';

/** The 11 states of design.md's "Estados do run" state machine, mirrored from the `ai_run_status` Postgres enum (F2a). */
export type AiRunStatus =
  | 'queued'
  | 'building_context'
  | 'calling_model'
  | 'validating'
  | 'previewing'
  | 'awaiting_approval'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'cancelled'
  | 'rejected';

export interface AiRunRow {
  id: string;
  diagramId: string;
  userId: string;
  providerConfigId: string;
  sourceRevision: number;
  status: AiRunStatus;
  promptRedacted: string | null;
  usageJson: unknown;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAiRunInput {
  diagramId: string;
  userId: string;
  providerConfigId: string;
  sourceRevision: number;
  promptRedacted: string;
}

export async function createAiRunRow(db: Db, input: CreateAiRunInput): Promise<AiRunRow> {
  const [row] = await db
    .insert(aiRuns)
    .values({
      diagramId: input.diagramId,
      userId: input.userId,
      providerConfigId: input.providerConfigId,
      sourceRevision: input.sourceRevision,
      promptRedacted: input.promptRedacted,
    })
    .returning();
  if (!row) throw new Error('createAiRunRow: insert returned no row');
  return row as AiRunRow;
}

export interface UpdateAiRunStatusInput {
  errorCode?: string | null;
  usageJson?: Record<string, unknown>;
}

export async function updateAiRunStatus(
  db: Db,
  id: string,
  status: AiRunStatus,
  extra: UpdateAiRunStatusInput = {},
): Promise<AiRunRow> {
  const [row] = await db
    .update(aiRuns)
    .set({
      status,
      updatedAt: new Date(),
      ...(extra.errorCode !== undefined ? { errorCode: extra.errorCode } : {}),
      ...(extra.usageJson !== undefined ? { usageJson: extra.usageJson } : {}),
    })
    .where(eq(aiRuns.id, id))
    .returning();
  if (!row) throw new Error(`updateAiRunStatus: no ai_runs row for id ${id}`);
  return row as AiRunRow;
}

export async function getAiRunById(db: Db, id: string): Promise<AiRunRow | null> {
  const [row] = await db.select().from(aiRuns).where(eq(aiRuns.id, id));
  return (row as AiRunRow | undefined) ?? null;
}

export interface InsertAiToolCallInput {
  aiRunId: string;
  toolName: string;
  argumentsRedacted: unknown;
  resultSummary: string | null;
  sequence: number;
}

export async function insertAiToolCall(db: Db, input: InsertAiToolCallInput): Promise<void> {
  await db.insert(aiToolCalls).values({
    aiRunId: input.aiRunId,
    toolName: input.toolName,
    argumentsRedacted: input.argumentsRedacted as Record<string, unknown>,
    resultSummary: input.resultSummary,
    sequence: input.sequence,
  });
}

/** Marks every tool call recorded for `aiRunId` as approved (T55, once the run's patch is actually applied). */
export async function markToolCallsApproved(db: Db, aiRunId: string): Promise<void> {
  await db.update(aiToolCalls).set({ approved: true }).where(eq(aiToolCalls.aiRunId, aiRunId));
}

export interface AiToolCallRow {
  id: string;
  aiRunId: string;
  toolName: string;
  argumentsRedacted: unknown;
  resultSummary: string | null;
  approved: boolean;
  sequence: number;
  createdAt: Date;
}

export async function listAiToolCalls(db: Db, aiRunId: string): Promise<AiToolCallRow[]> {
  return (await db
    .select()
    .from(aiToolCalls)
    .where(and(eq(aiToolCalls.aiRunId, aiRunId)))) as AiToolCallRow[];
}
